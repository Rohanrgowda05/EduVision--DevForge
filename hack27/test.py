from dotenv import load_dotenv
load_dotenv()

from langchain_groq.chat_models import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

llm = ChatGroq(
    model="llama-3.3-70b-instruct",
    temperature=0.2,
)

response = llm.invoke([
    HumanMessage(content="Say hello world.")
])

print("MODEL:", response.response_metadata.get("model_name"))
print("OUTPUT:", response.content)
