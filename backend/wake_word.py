import time
import random
import numpy as np

class WakeWord:
    def __init__(self):
        self.running = False

    def listen(self):
        """
        Simulates listening to audio stream.
        In a real implementation, this would yield chunks of audio data from a microphone.
        """
        print("Listening for wake word...")
        self.running = True
        while self.running:
            # Simulate an audio chunk (e.g., 16000 samples for 1 second at 16kHz)
            # using numpy to mock audio data
            chunk = np.random.uniform(-1, 1, 1600)  # 0.1 second chunk
            time.sleep(0.1)  # Simulate real-time delay
            yield chunk

    def inference(self, audio_chunk):
        """
        Mock inference logic.
        Returns True if wake word is detected, False otherwise.
        """
        # Mocking model prediction
        # In reality, you'd pass 'audio_chunk' to a model
        # Here we simulate a random detection events
        probability = random.random()
        if probability > 0.95:  # 5% chance of detection
            return True
        return False

    def stop(self):
        self.running = False

if __name__ == "__main__":
    wake_word_service = WakeWord()
    
    try:
        for audio_chunk in wake_word_service.listen():
            if wake_word_service.inference(audio_chunk):
                print("Wake word detected!")
                # In a real app, you might trigger an event or callback here
    except KeyboardInterrupt:
        print("\nStopping wake word service...")
        wake_word_service.stop()
