"""Speech-to-Text router for voice input transcription."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import AuthenticatedUser, get_current_user
from app.schemas import SpeechToTextRequest, SpeechToTextResponse
from app.services import speech_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/speech", tags=["speech"])


@router.post("/transcribe", response_model=SpeechToTextResponse)
async def transcribe_audio(
	request: SpeechToTextRequest,
	current_user: AuthenticatedUser = Depends(get_current_user),
):
	"""Transcribe audio to text using Google Cloud Speech-to-Text.

	Accepts base64-encoded audio data (WebM/Opus format from browser MediaRecorder)
	and returns the transcribed text.

	Args:
		request: Speech transcription request with audio_data and language_code
		current_user: Authenticated user

	Returns:
		SpeechToTextResponse with transcript, confidence, and is_final flag

	Raises:
		HTTPException: If transcription fails
	"""
	try:
		result = await speech_service.transcribe_audio(
			audio_data=request.audio_data,
			language_code=request.language_code
		)

		return SpeechToTextResponse(
			transcript=result["transcript"],
			confidence=result["confidence"],
			is_final=result["is_final"]
		)

	except ValueError as e:
		logger.error(f"Invalid request: {e}")
		raise HTTPException(
			status_code=status.HTTP_400_BAD_REQUEST,
			detail=str(e)
		)
	except Exception as e:
		logger.error(f"Transcription failed: {e}")
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail=f"Transcription failed: {str(e)}"
		)
