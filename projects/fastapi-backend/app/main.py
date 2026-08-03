from fastapi import FastAPI

app = FastAPI(title="Agent Dev Company API")

@app.get("/")
async def root():
    return {"message": "Hello from Agent Dev Company"}
