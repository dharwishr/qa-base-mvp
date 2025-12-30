"""Google Cloud Speech-to-Text service using REST API."""

import base64
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

SPEECH_API_URL = "https://speech.googleapis.com/v1/speech:recognize"


async def transcribe_audio(
    audio_data: str,
    language_code: str = "en-US"
) -> dict:
    """Transcribe base64-encoded audio data to text using Google Cloud Speech-to-Text REST API.

    Args:
        audio_data: Base64 encoded audio data (WebM/Opus format from browser)
        language_code: BCP-47 language code (default: en-US)

    Returns:
        Dictionary with transcript, confidence, and is_final flag
    """
    api_key = settings.GOOGLE_SPEECH_API_KEY

    if not api_key:
        raise ValueError(
            "GOOGLE_SPEECH_API_KEY not set. "
            "Set it in your .env file with your Google Cloud API key."
        )

    # Validate base64 audio data
    try:
        audio_bytes = base64.b64decode(audio_data)
    except Exception as e:
        raise ValueError(f"Invalid base64 audio data: {e}")

    if len(audio_bytes) == 0:
        raise ValueError("Empty audio data")

    logger.info(f"Transcribing {len(audio_bytes)} bytes of audio, language: {language_code}")

    # Build request payload
    request_body = {
        "config": {
            "encoding": "WEBM_OPUS",
            "sampleRateHertz": 48000,
            "languageCode": language_code,
            "enableAutomaticPunctuation": True,
            "model": "latest_long",
        },
        "audio": {
            "content": audio_data
        }
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                SPEECH_API_URL,
                params={"key": api_key},
                json=request_body,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code != 200:
                error_detail = response.text
                logger.error(f"Speech API error: {response.status_code} - {error_detail}")
                raise Exception(f"Speech API error: {response.status_code} - {error_detail}")

            result = response.json()

        results = result.get("results", [])
        if not results:
            logger.warning("No speech detected in audio")
            return {"transcript": "", "confidence": 0.0, "is_final": True}

        alternative = results[0].get("alternatives", [{}])[0]
        transcript = alternative.get("transcript", "")
        confidence = alternative.get("confidence", 0.9)

        logger.info(f"Transcription: '{transcript[:50]}...' (confidence: {confidence:.2f})")

        return {
            "transcript": transcript,
            "confidence": confidence,
            "is_final": True
        }

    except httpx.TimeoutException:
        logger.error("Speech API request timed out")
        raise Exception("Transcription request timed out. Please try again.")
    except Exception as e:
        logger.error(f"Speech transcription failed: {e}")
        raise
