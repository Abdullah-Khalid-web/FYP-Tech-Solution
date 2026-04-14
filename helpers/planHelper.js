// helpers/planHelper.js

/**
 * Extract features array from plan object
 * @param {Object|string} plan - The plan object or features string
 * @returns {Array} Array of features
 */
function extractFeatures(plan) {
  if (!plan) return [];
  
  let features = [];
  
  try {
    // If plan.features exists and is a string
    if (plan.features) {
      // Try to parse as JSON
      const parsed = JSON.parse(plan.features);
      
      if (Array.isArray(parsed)) {
        features = parsed;
      } 
      else if (parsed && typeof parsed === 'object') {
        // Check for common property names
        if (Array.isArray(parsed.features_list)) {
          features = parsed.features_list;
        } else if (Array.isArray(parsed.features)) {
          features = parsed.features;
        } else if (Array.isArray(parsed.items)) {
          features = parsed.items;
        } else {
          // Try to find any array in the object
          for (let key in parsed) {
            if (Array.isArray(parsed[key])) {
              features = parsed[key];
              break;
            }
          }
        }
      }
    }
    // If plan itself is a string
    else if (typeof plan === 'string') {
      try {
        const parsed = JSON.parse(plan);
        if (Array.isArray(parsed)) {
          features = parsed;
        }
      } catch {
        // If not JSON, treat as comma-separated string
        if (plan.includes(',')) {
          features = plan.split(',').map(f => f.trim());
        } else {
          features = [plan];
        }
      }
    }
    // If plan is already an array
    else if (Array.isArray(plan)) {
      features = plan;
    }
  } catch (e) {
    console.error('Error extracting features:', e);
    // Fallback to empty array
  }
  
  return features;
}

module.exports = {
  extractFeatures
};