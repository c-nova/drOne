from pydantic import BaseModel, Field
from typing import Optional, List, Any

class StartResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Research query text")
    tool_choice: Optional[str] = None
    deep_research_model: Optional[str] = None
    bing_grounding_connections: Optional[Any] = None
