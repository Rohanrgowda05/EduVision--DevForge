from typing import List, Literal, Optional
from pydantic import BaseModel, Field

class StudyPlanModel(BaseModel):
    action: Literal["generate_new", "reuse_existing", "remedial", "advanced"]
    focusConcepts: List[str] = Field(default_factory=list, max_length=3)
    difficulty: Literal["intro", "standard", "challenging"] = "standard"
    includeYoutube: bool = False
    rationale: str
    reusedVideoUrl: Optional[str] = None

