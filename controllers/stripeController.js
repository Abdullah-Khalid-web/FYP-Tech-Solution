const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db');

class StripeController {
    // Create payment intent
    async createPaymentIntent(req, res) {
        try {
            const { amount, planName, duration, shopData } = req.body;
            
            console.log('Creating payment intent for:', { amount, planName, duration });
            
            if (!amount || amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid amount'
                });
            }
            
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(amount * 100), // Convert to cents/paisa
                currency: process.env.STRIPE_CURRENCY || 'pkr',
                metadata: {
                    plan_name: planName,
                    duration: duration,
                    shop_name: shopData?.shopName || 'Unknown',
                    owner_email: shopData?.ownerEmail || 'Unknown'
                },
                description: `Subscription Payment - ${planName} (${duration})`
            });

            res.json({
                success: true,
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id
            });
        } catch (error) {
            console.error('Stripe payment intent error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // Handle webhook from Stripe
    async handleWebhook(req, res) {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        
        let event;
        
        try {
            if (webhookSecret) {
                event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
            } else {
                event = req.body;
            }
        } catch (err) {
            console.error(`Webhook Error: ${err.message}`);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }
        
        // Handle the event
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object;
                console.log('Payment succeeded:', paymentIntent.id);
                await this.handleSuccessfulPayment(paymentIntent);
                break;
            case 'payment_intent.payment_failed':
                const failedPayment = event.data.object;
                console.log('Payment failed:', failedPayment.id);
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
        
        res.json({ received: true });
    }

    // Handle successful payment
    async handleSuccessfulPayment(paymentIntent) {
        try {
            const metadata = paymentIntent.metadata;
            const amount = paymentIntent.amount / 100;
            
            // Check if table exists before inserting
            try {
                await pool.execute(
                    `INSERT INTO payment_transactions 
                    (id, transaction_id, amount, currency, status, payment_method, metadata, created_at)
                    VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, 'completed', 'stripe', ?, NOW())`,
                    [paymentIntent.id, amount, process.env.STRIPE_CURRENCY || 'pkr', JSON.stringify(metadata)]
                );
            } catch (tableError) {
                // Table might not exist, create it
                console.log('Payment transactions table may not exist:', tableError.message);
            }
            
            console.log(`Payment successful for ${metadata.shop_name}: ${amount}`);
        } catch (error) {
            console.error('Error handling successful payment:', error);
        }
    }
}

module.exports = new StripeController();