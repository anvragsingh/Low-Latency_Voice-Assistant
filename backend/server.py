import asyncio
import json
import time
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import os
import sys
import edge_tts
import base64

# --- CONFIGURATION ---
WHISPER_MODEL_SIZE = "tiny.en"  # Options: tiny.en, base.en, small.en
VAD_THRESHOLD = 0.01   # Energy threshold for voice activity
SILENCE_LIMIT = 1.5    # Seconds of silence to trigger processing (reduced from 2.0)
SAMPLE_RATE = 16000    # Required by Whisper
TTS_VOICE = "en-US-AriaNeural" # Edge-TTS voice

app = FastAPI()

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model storage
asr_model = None

def load_models():
    """Load models with error handling"""
    global asr_model
    
    print("=" * 60)
    print("🔄 LOADING MODELS...")
    print("=" * 60)
    
    try:
        # Check for GPU
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            compute_type = "int8" if device == "cpu" else "float16"
            print(f"✓ Using device: {device}")
        except ImportError:
            device = "cpu"
            compute_type = "int8"
            print("✓ Using device: cpu (torch not available)")
        
        # Load Whisper
        print(f"📝 Loading Whisper model: {WHISPER_MODEL_SIZE}...")
        asr_model = WhisperModel(
            WHISPER_MODEL_SIZE, 
            device=device, 
            compute_type=compute_type,
            download_root="./models"  # Cache models locally
        )
        print("✓ Whisper model loaded successfully")
        
        print("=" * 60)
        print("✅ ALL MODELS LOADED - SERVER READY")
        print("=" * 60)
        return True
        
    except Exception as e:
        print(f"❌ Error loading models: {e}")
        print("Tip: Run 'pip install faster-whisper' and ensure internet connection for first download")
        return False

# Simple response generator (no LLM required for testing)
def generate_response(text: str) -> str:
    """Generate simple responses without LLM"""
    text_lower = text.lower()
    
    # Simple keyword-based responses
    responses = {
        "hello": "Hello! How can I help you today?",
        "hi": "Hi there! What can I do for you?",
        "weather": "I don't have access to real-time weather data, but I can help you with other questions!",
        "time": f"The current time is {time.strftime('%I:%M %p')}",
        "name": "I'm your local voice assistant, running entirely on your machine!",
        "how are you": "I'm functioning perfectly! How can I assist you?",
        "thank": "You're welcome! Is there anything else I can help with?",
        "bye": "Goodbye! Have a great day!",
    }
    
    for keyword, response in responses.items():
        if keyword in text_lower:
            return response
    
    # Default response
    return f"You said: '{text}'. I'm a simple demo assistant. Try asking about the time, weather, or just say hello!"

@app.on_event("startup")
async def startup_event():
    """Load models on startup"""
    success = load_models()
    if not success:
        print("\n⚠️  WARNING: Models failed to load. Server may not work properly.\n")

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "whisper_model": WHISPER_MODEL_SIZE,
        "model_loaded": asr_model is not None
    }

@app.get("/health")
async def health():
    """Detailed health check"""
    return {
        "status": "healthy" if asr_model else "degraded",
        "asr_loaded": asr_model is not None,
        "config": {
            "whisper_model": WHISPER_MODEL_SIZE,
            "vad_threshold": VAD_THRESHOLD,
            "silence_limit": SILENCE_LIMIT,
            "sample_rate": SAMPLE_RATE
        }
    }

@app.websocket("/ws/audio")
async def audio_websocket(websocket: WebSocket):
    """WebSocket endpoint for audio streaming"""
    await websocket.accept()
    client_id = id(websocket)
    print(f"✓ Client {client_id} connected")
    
    # Audio Buffer State
    audio_buffer = []
    is_speaking = False
    silence_start = None
    total_chunks = 0
    
    try:
        # Send initial status
        await websocket.send_json({"type": "status", "message": "idle"})
        
        while True:
            # Receive raw audio bytes (Int16) from React
            data = await websocket.receive_bytes()
            total_chunks += 1
            
            # Convert bytes to numpy float32 for processing
            chunk = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            audio_buffer.append(chunk)
            
            # --- Simple VAD (Voice Activity Detection) ---
            energy = np.sqrt(np.mean(chunk**2))
            
            # Debug logging for energy levels
            if total_chunks % 10 == 0:  # Log every 10th chunk to avoid spam
                print(f"Energy: {energy:.4f} (Threshold: {VAD_THRESHOLD})")

            
            if energy > VAD_THRESHOLD:
                if not is_speaking:
                    is_speaking = True
                    print(f"🎤 Voice detected from client {client_id}")
                    await websocket.send_json({"type": "status", "message": "listening"})
                silence_start = None
            else:
                if is_speaking and silence_start is None:
                    silence_start = time.time()
            
            # --- Trigger Processing if Silence Persists ---
            if is_speaking and silence_start and (time.time() - silence_start > SILENCE_LIMIT):
                print(f"🔇 Silence detected. Processing audio from client {client_id}...")
                await websocket.send_json({"type": "status", "message": "processing"})
                
                # 1. Prepare Audio
                full_audio = np.concatenate(audio_buffer)
                audio_duration = len(full_audio) / SAMPLE_RATE
                print(f"📊 Audio duration: {audio_duration:.2f}s, Chunks: {total_chunks}")
                
                # Reset buffer
                audio_buffer = []
                total_chunks = 0
                is_speaking = False
                silence_start = None
                
                # 2. Transcribe (ASR)
                if asr_model is None:
                    await websocket.send_json({
                        "type": "error",
                        "message": "ASR model not loaded"
                    })
                    continue
                
                start_asr = time.perf_counter()
                try:
                    segments, info = asr_model.transcribe(
                        full_audio, 
                        beam_size=1,  # Faster, less accurate (use 5 for production)
                        language="en",
                        condition_on_previous_text=False  # Faster for short queries
                    )
                    text = " ".join([s.text for s in segments]).strip()
                    asr_latency = (time.perf_counter() - start_asr) * 1000
                    
                    print(f"✓ ASR completed in {asr_latency:.0f}ms")
                    
                except Exception as e:
                    print(f"❌ ASR Error: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Transcription failed: {str(e)}"
                    })
                    continue
                
                if not text:
                    print("⚠️  Empty transcription, ignoring")
                    await websocket.send_json({"type": "status", "message": "idle"})
                    continue
                
                print(f"👤 User said: '{text}'")
                await websocket.send_json({
                    "type": "transcript", 
                    "text": text,
                    "latency": asr_latency
                })
                
                # 3. Generate Response (Simple keyword-based)
                start_llm = time.perf_counter()
                response_text = generate_response(text)
                ttft = (time.perf_counter() - start_llm) * 1000
                
                # Send latency stats
                await websocket.send_json({
                    "type": "latency_stats",
                    "asr": asr_latency,
                    "ttft": ttft
                })
                
                # Stream response word by word for realistic effect
                words = response_text.split()
                for word in words:
                    await websocket.send_json({"type": "token", "text": word + " "})
                    await asyncio.sleep(0.05)  # Simulate streaming delay
                
                print(f"🤖 Assistant: '{response_text}'")

                # 4. Generate & Stream Audio (TTS)
                try:
                    communicate = edge_tts.Communicate(response_text, TTS_VOICE)
                    audio_chunks = []
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            audio_chunks.append(chunk["data"])
                    
                    if audio_chunks:
                        full_audio = b"".join(audio_chunks)
                        audio_base64 = base64.b64encode(full_audio).decode("utf-8")
                        await websocket.send_json({
                            "type": "audio",
                            "data": audio_base64
                        })
                except Exception as e:
                    print(f"❌ TTS Error: {e}")

                await websocket.send_json({"type": "status", "message": "idle"})

    except WebSocketDisconnect:
        print(f"✗ Client {client_id} disconnected")
    except Exception as e:
        print(f"❌ Error with client {client_id}: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    
    print("\n" + "=" * 60)
    print("🚀 STARTING VOICE ASSISTANT BACKEND")
    print("=" * 60)
    print(f"Configuration:")
    print(f"  - Whisper Model: {WHISPER_MODEL_SIZE}")
    print(f"  - VAD Threshold: {VAD_THRESHOLD}")
    print(f"  - Silence Limit: {SILENCE_LIMIT}s")
    print("=" * 60 + "\n")
    
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000,
        log_level="info"
    )