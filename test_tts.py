import asyncio
import edge_tts
import os

OUTPUT_FILE = "test_audio.mp3"
TTS_VOICE = "en-US-AriaNeural"

async def main():
    text = "Hello, this is a test of the text to speech integration."
    print(f"Generating audio for: '{text}'")
    communicate = edge_tts.Communicate(text, TTS_VOICE)
    await communicate.save(OUTPUT_FILE)
    print(f"Audio saved to {OUTPUT_FILE}")
    
    # Check if file exists and has size
    if os.path.exists(OUTPUT_FILE) and os.path.getsize(OUTPUT_FILE) > 0:
        print("SUCCESS: Audio file created and is not empty.")
    else:
        print("FAILURE: Audio file was not created or is empty.")

if __name__ == "__main__":
    loop = asyncio.get_event_loop_policy().get_event_loop()
    loop.run_until_complete(main())
