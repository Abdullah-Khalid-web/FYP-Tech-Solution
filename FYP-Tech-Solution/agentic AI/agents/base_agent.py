"""
Base Agent - Abstract base class implementing the 6-step agentic cycle.
All specialized agents inherit from this class.
Updated for LangChain 1.x compatibility.
"""

from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
import json
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import BaseTool

from config import settings
from schemas import AgentResponse, IntentType, ActionStatus, AgentType


class BaseAgent(ABC):
    """
    Abstract base class for all retail AI agents.
    Implements the 6-step agentic cycle:
    1. Perception - Understand input
    2. Reasoning - Determine intent & data needs
    3. Planning - Decide which tools to call
    4. Action - Execute tool calls
    5. Reflection - Validate response
    6. Explanation - Generate human-friendly response
    """
    
    def __init__(
        self,
        agent_type: AgentType,
        tools: List,
        system_prompt: str,
        shop_id: int = None
    ):
        self.agent_type = agent_type
        self.tools = tools
        self.system_prompt = system_prompt
        self.shop_id = shop_id or settings.DEFAULT_SHOP_ID
        
        # Initialize LLM (Groq)
        self.llm = ChatGroq(
            model_name=settings.LLM_MODEL,
            temperature=settings.LLM_TEMPERATURE,
            api_key=settings.GROQ_API_KEY
        )
        
        # Bind tools to LLM for tool calling
        if tools:
            self.llm_with_tools = self.llm.bind_tools(tools)
        else:
            self.llm_with_tools = self.llm
        
        # Build tool lookup by name for execution
        self.tools_by_name = {}
        for t in (tools or []):
            name = getattr(t, 'name', None) or (t.name if hasattr(t, 'name') else None)
            if name:
                self.tools_by_name[name] = t
        
        # Conversation history for context
        self.conversation_history: List = []
    
    # =========================================================================
    # 6-Step Agentic Cycle
    # =========================================================================
    
    async def process(self, user_input: str, context: Optional[Dict] = None) -> AgentResponse:
        """
        Main processing method implementing the 6-step agentic cycle.
        """
        # Step 1: Perception
        perceived_input = await self.perceive(user_input, context)
        
        # Step 2: Reasoning
        intent, data_needs = await self.reason(perceived_input)
        
        # Step 3: Planning
        plan = await self.plan(intent, data_needs)
        
        # Step 4: Action
        action_result = await self.act(plan, perceived_input)
        
        # Step 5: Reflection
        validated_result = await self.reflect(action_result)
        
        # Step 6: Explanation
        response = await self.explain(validated_result, intent)
        
        return response
    
    async def perceive(self, user_input: str, context: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Step 1: Perception - Parse and understand the input.
        Extract entities, normalize text, handle context.
        """
        perceived = {
            "original_input": user_input,
            "normalized_input": user_input.lower().strip(),
            "context": context or {},
            "shop_id": self.shop_id,
        }
        
        # Extract entities using LLM
        entities = await self._extract_entities(user_input)
        perceived["entities"] = entities
        
        return perceived
    
    async def _extract_entities(self, text: str) -> Dict[str, Any]:
        """Extract entities like product names, quantities, dates from text."""
        extraction_prompt = f"""
        Extract entities from this retail query. Return as JSON:
        - product_name: product mentioned (if any)
        - quantity: number mentioned (if any)
        - date: date mentioned (if any)
        - time_period: period like "today", "this week", "last month" (if any)
        - person: staff name or role mentioned (if any)
        
        Query: {text}
        
        Return ONLY valid JSON, nothing else.
        """
        
        try:
            result = await self.llm.ainvoke([HumanMessage(content=extraction_prompt)])
            import json
            # Try to extract JSON from response
            content = result.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            return json.loads(content)
        except:
            return {}
    
    @abstractmethod
    async def reason(self, perceived_input: Dict) -> tuple:
        """
        Step 2: Reasoning - Determine intent and required data.
        Must be implemented by each specialized agent.
        """
        pass
    
    @abstractmethod
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        """
        Step 3: Planning - Decide which tools/APIs to call.
        Must be implemented by each specialized agent.
        """
        pass
    
    async def act(self, plan: Dict, perceived_input: Dict) -> Dict[str, Any]:
        """
        Step 4: Action - Execute the plan using LLM with tools.
        Implements a tool-calling loop: invoke LLM → execute tools → feed
        results back → repeat until the LLM produces a final text answer.
        """
        try:
            # Build messages with system prompt and user input
            messages = [
                {"role": "system", "content": self.system_prompt.format(shop_id=self.shop_id)},
            ]
            
            # Add conversation history
            for msg in self.conversation_history[-10:]:
                if isinstance(msg, HumanMessage):
                    messages.append({"role": "user", "content": msg.content})
                elif isinstance(msg, AIMessage):
                    messages.append({"role": "assistant", "content": msg.content})
            
            # Add current user input
            messages.append({"role": "user", "content": perceived_input["original_input"]})
            
            all_tool_calls = []
            max_iterations = 5  # Safety limit to prevent infinite loops
            
            for iteration in range(max_iterations):
                # Invoke LLM with tools
                result = await self.llm_with_tools.ainvoke(messages)
                
                tool_calls = getattr(result, 'tool_calls', [])
                
                # If no tool calls, we have the final text response
                if not tool_calls:
                    break
                
                # LLM wants to call tools — execute each one
                all_tool_calls.extend(tool_calls)
                
                # Append the AI message (with tool calls) to the conversation
                messages.append(result)
                
                for tc in tool_calls:
                    tool_name = tc.get('name', '') if isinstance(tc, dict) else getattr(tc, 'name', '')
                    tool_args = tc.get('args', {}) if isinstance(tc, dict) else getattr(tc, 'args', {})
                    tool_id = tc.get('id', '') if isinstance(tc, dict) else getattr(tc, 'id', '')
                    
                    if settings.VERBOSE_LOGGING:
                        print(f"  [TOOL] Executing: {tool_name}({tool_args})")
                    
                    # Look up and execute the tool
                    tool_fn = self.tools_by_name.get(tool_name)
                    if tool_fn:
                        try:
                            tool_result = await tool_fn.ainvoke(tool_args)
                        except Exception as tool_err:
                            tool_result = {"error": f"Tool execution failed: {str(tool_err)}"}
                    else:
                        tool_result = {"error": f"Unknown tool: {tool_name}"}
                    
                    # Convert result to string for the ToolMessage
                    if not isinstance(tool_result, str):
                        tool_result_str = json.dumps(tool_result, default=str)
                    else:
                        tool_result_str = tool_result
                    
                    if settings.VERBOSE_LOGGING:
                        print(f"  [OK] Tool result: {tool_result_str[:200]}")
                    
                    # Append tool result as a ToolMessage
                    messages.append(ToolMessage(
                        content=tool_result_str,
                        tool_call_id=tool_id,
                    ))
            
            # Extract final text content
            output_content = result.content
            if isinstance(output_content, list):
                text_parts = []
                for part in output_content:
                    if isinstance(part, str):
                        text_parts.append(part)
                    elif isinstance(part, dict) and "text" in part:
                        text_parts.append(part["text"])
                output_content = " ".join(text_parts).strip()
                
            if not isinstance(output_content, str):
                output_content = str(output_content)
                
            # Store in conversation history
            self.conversation_history.append(HumanMessage(content=perceived_input["original_input"]))
            self.conversation_history.append(AIMessage(content=output_content))
            
            return {
                "success": True,
                "output": output_content,
                "tool_calls": all_tool_calls,
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {
                "success": False,
                "error": str(e),
                "output": None,
            }
    
    async def reflect(self, action_result: Dict) -> Dict[str, Any]:
        """
        Step 5: Reflection - Validate the response.
        Check for errors, incomplete data, or issues.
        """
        if not action_result.get("success"):
            return {
                "valid": False,
                "error": action_result.get("error"),
                "needs_retry": True,
                "output": None,
            }
        
        output = action_result.get("output")
        
        # Validate response is not empty
        if not output:
            return {
                "valid": False,
                "error": "Empty response from AI",
                "needs_retry": True,
                "output": output,
            }
        
        return {
            "valid": True,
            "output": output,
            "tool_calls": action_result.get("tool_calls", []),
        }
    
    async def explain(self, validated_result: Dict, intent: IntentType) -> AgentResponse:
        """
        Step 6: Explanation - Generate human-friendly response.
        """
        if not validated_result.get("valid"):
            return AgentResponse(
                status=ActionStatus.FAILED,
                agent_type=self.agent_type,
                intent=intent,
                response=f"I encountered an issue: {validated_result.get('error', 'Unknown error')}. Please try again.",
                reasoning="Error during processing"
            )
        
        return AgentResponse(
            status=ActionStatus.SUCCESS,
            agent_type=self.agent_type,
            intent=intent,
            response=validated_result.get("output", ""),
            reasoning=self._format_reasoning(validated_result.get("tool_calls", []))
        )
    
    def _format_reasoning(self, tool_calls: List) -> str:
        """Format tool calls into human-readable reasoning."""
        if not tool_calls:
            return "Direct response based on query understanding."
        
        steps = []
        for i, call in enumerate(tool_calls, 1):
            tool_name = call.get('name', 'Unknown tool') if isinstance(call, dict) else getattr(call, 'name', 'Unknown')
            steps.append(f"{i}. Called {tool_name}")
        
        return " → ".join(steps) if steps else "Processed query directly."
    
    def clear_history(self):
        """Clear conversation history."""
        self.conversation_history = []
