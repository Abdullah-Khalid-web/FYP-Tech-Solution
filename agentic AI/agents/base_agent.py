"""
Base Agent - Abstract base class implementing the 6-step agentic cycle.
All specialized agents inherit from this class.
Updated for LangChain 1.x compatibility.
"""

from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
import json
import re
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
        
        # We keep bind_tools for compatibility but primarily use manual JSON routing
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
            # Try to extract JSON from response
            content = result.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            return json.loads(content)
        except Exception:
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
        Step 4: Action - Execute the plan using manual JSON-based tool routing.
        
        Instead of relying on Groq's native tool-calling API (which generates
        malformed XML tags like <function=...>), we ask the LLM to output
        structured JSON when it wants to use a tool. This works reliably
        with ALL Groq models.
        """
        try:
            # Build tool descriptions for the prompt
            tool_descriptions = []
            for name, tool in self.tools_by_name.items():
                desc = getattr(tool, 'description', '') or name
                # Clean the description to one line
                desc = ' '.join(desc.split())
                tool_descriptions.append(f"  - {name}: {desc}")
            
            tools_text = "\n".join(tool_descriptions) if tool_descriptions else "  No tools available."
            
            system_content = self.system_prompt.format(shop_id=self.shop_id)
            system_content += "\n\nAVAILABLE TOOLS:\n"
            system_content += tools_text
            system_content += """

HOW TO RESPOND:
When you need data from a tool, respond with EXACTLY this JSON format and nothing else:
{"action": "tool_call", "tool": "tool_name_here", "args": {"arg_name": "value"}}

When you have all the information needed to answer the user, respond with EXACTLY this JSON:
{"action": "final_answer", "response": "Your helpful, detailed answer here."}

RULES:
- ALWAYS respond with valid JSON only. No extra text before or after the JSON.
- When generating JSON, ALL newlines inside strings MUST be escaped as \\n. Do not output raw newlines inside the JSON string.
- When formatting currency or money, ALWAYS use "Rs." instead of the "$" sign (e.g., Rs. 500).
- Call ONE tool at a time.
- Only use tools from the AVAILABLE TOOLS list above.
- If a tool returns an error, explain the situation to the user in your final answer.
"""
            
            messages = [
                {"role": "system", "content": system_content},
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
            max_iterations = 5
            output_content = ""
            action_data = None
            
            for iteration in range(max_iterations):
                # Call LLM WITHOUT tool binding - just plain text completion
                result = await self.llm.ainvoke(messages)
                
                response_text = result.content.strip() if result.content else ""
                
                # Try to parse as JSON
                parsed = self._try_parse_json(response_text)
                
                if parsed and isinstance(parsed, dict) and parsed.get("action") == "tool_call":
                    # LLM wants to call a tool
                    tool_name = parsed.get("tool", "")
                    tool_args = parsed.get("args", {})
                    
                    if settings.VERBOSE_LOGGING:
                        print(f"  [TOOL] Executing: {tool_name}({tool_args})")
                    all_tool_calls.append({"name": tool_name, "args": tool_args})
                    
                    # Execute the tool
                    tool_fn = self.tools_by_name.get(tool_name)
                    if tool_fn:
                        try:
                            tool_result = await tool_fn.ainvoke(tool_args)
                        except Exception as te:
                            tool_result = {"error": f"Tool failed: {str(te)}"}
                    else:
                        available = ", ".join(self.tools_by_name.keys())
                        tool_result = {"error": f"Tool '{tool_name}' not found. Available tools: {available}"}
                    
                    # Convert to string
                    if not isinstance(tool_result, str):
                        tool_result_str = json.dumps(tool_result, default=str, ensure_ascii=True)
                    else:
                        tool_result_str = tool_result
                    
                    if settings.VERBOSE_LOGGING:
                        print(f"  [OK] Tool result: {tool_result_str[:300]}")
                    
                    # Feed tool result back and ask for next action
                    messages.append({"role": "assistant", "content": response_text})
                    messages.append({
                        "role": "user",
                        "content": f"Tool '{tool_name}' returned: {tool_result_str}\n\nNow either call another tool if needed, or provide your final answer using: {{\"action\": \"final_answer\", \"response\": \"your answer\"}}"
                    })
                    continue
                    
                elif parsed and isinstance(parsed, dict) and parsed.get("action") == "final_answer":
                    # LLM has the final answer
                    output_content = parsed.get("response", "")
                    action_data = parsed.get("data", None)
                    break
                else:
                    # Not valid JSON or unknown action - use raw text as the answer
                    output_content = response_text
                    break
            
            if not output_content:
                output_content = "I was unable to process your request. Please try again."
            
            # Store in conversation history
            self.conversation_history.append(HumanMessage(content=perceived_input["original_input"]))
            self.conversation_history.append(AIMessage(content=output_content))
            
            return {
                "success": True,
                "output": output_content,
                "tool_calls": all_tool_calls,
                "data": action_data
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {
                "success": False,
                "error": str(e),
                "output": None,
            }
    
    def _try_parse_json(self, text: str):
        """Try to parse JSON from LLM response, handling markdown code blocks."""
        if not text:
            return None
        
        # Strip markdown code fences if present
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            # Remove first and last lines (the ``` markers)
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
        
        # Try to find JSON object in the text
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
        
        return None
    
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
            "data": action_result.get("data"),
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
            data=validated_result.get("data", None),
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
        
        return " -> ".join(steps) if steps else "Processed query directly."
    
    def clear_history(self):
        """Clear conversation history."""
        self.conversation_history = []
