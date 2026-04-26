# example.py
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from io import BytesIO
import requests
from elevenlabs.client import ElevenLabs

load_dotenv()

elevenlabs = ElevenLabs(
  api_key=os.getenv("ELEVENLABS_API_KEY"),
)

audio_path = sys.argv[1] if len(sys.argv) > 1 else os.getenv("ELEVENLABS_AUDIO_FILE")

if audio_path:
    audio_file = Path(audio_path).expanduser()
    with audio_file.open("rb") as f:
        transcription = elevenlabs.speech_to_text.convert(
            file=f,
            model_id="scribe_v2", # Model to use
            tag_audio_events=True, # Tag audio events like laughter, applause, etc.
            language_code="eng", # Language of the audio file. If set to None, the model will detect the language automatically.
            diarize=True, # Whether to annotate who is speaking
        )
else:
    audio_url = (
        "https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3"
    )
    response = requests.get(audio_url)
    audio_data = BytesIO(response.content)

    transcription = elevenlabs.speech_to_text.convert(
        file=audio_data,
        model_id="scribe_v2", # Model to use
        tag_audio_events=True, # Tag audio events like laughter, applause, etc.
        language_code="eng", # Language of the audio file. If set to None, the model will detect the language automatically.
        diarize=True, # Whether to annotate who is speaking
    )

print(transcription.text)
