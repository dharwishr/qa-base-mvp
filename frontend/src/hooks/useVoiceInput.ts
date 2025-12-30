import { useState, useRef, useCallback } from 'react';
import { speechApi } from '@/services/api';

export interface UseVoiceInputOptions {
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
  languageCode?: string;
}

export interface UseVoiceInputReturn {
  isListening: boolean;
  isProcessing: boolean;
  error: string | null;
  isSupported: boolean;
  startListening: () => Promise<void>;
  stopListening: () => Promise<string>;
}

/**
 * Hook for capturing voice input and transcribing it using Google Cloud Speech-to-Text.
 * Records audio, then sends to backend for transcription when stopped.
 */
export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const { onTranscript, onError, languageCode = 'en-US' } = options;

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const isSupported = typeof window !== 'undefined' &&
    'mediaDevices' in navigator &&
    'MediaRecorder' in window;

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) {
      const errorMsg = 'Voice input is not supported in this browser';
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        }
      });
      streamRef.current = stream;

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        const errorMsg = 'Recording error occurred';
        setError(errorMsg);
        onError?.(errorMsg);
        cleanup();
        setIsListening(false);
      };

      mediaRecorder.start(1000);
      setIsListening(true);
    } catch (err) {
      let errorMsg = 'Failed to access microphone';
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          errorMsg = 'Microphone access denied. Please allow microphone access.';
        } else if (err.name === 'NotFoundError') {
          errorMsg = 'No microphone found.';
        } else {
          errorMsg = err.message;
        }
      }
      setError(errorMsg);
      onError?.(errorMsg);
      cleanup();
    }
  }, [isSupported, onError, cleanup]);

  const stopListening = useCallback(async (): Promise<string> => {
    if (!mediaRecorderRef.current || !isListening) {
      return '';
    }

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!;

      mediaRecorder.onstop = async () => {
        setIsListening(false);
        setIsProcessing(true);
        setError(null);

        try {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: mediaRecorder.mimeType || 'audio/webm'
          });

          if (audioBlob.size === 0) {
            const errorMsg = 'No audio recorded';
            setError(errorMsg);
            onError?.(errorMsg);
            setIsProcessing(false);
            cleanup();
            resolve('');
            return;
          }

          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const base64Audio = (reader.result as string).split(',')[1];
              const result = await speechApi.transcribe(base64Audio, languageCode);

              if (result.transcript) {
                onTranscript?.(result.transcript);
                resolve(result.transcript);
              } else {
                const errorMsg = 'No speech detected. Please try again.';
                setError(errorMsg);
                onError?.(errorMsg);
                resolve('');
              }
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : 'Transcription failed';
              setError(errorMsg);
              onError?.(errorMsg);
              resolve('');
            } finally {
              setIsProcessing(false);
              cleanup();
            }
          };

          reader.onerror = () => {
            const errorMsg = 'Failed to process audio';
            setError(errorMsg);
            onError?.(errorMsg);
            setIsProcessing(false);
            cleanup();
            resolve('');
          };

          reader.readAsDataURL(audioBlob);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Failed to process audio';
          setError(errorMsg);
          onError?.(errorMsg);
          setIsProcessing(false);
          cleanup();
          resolve('');
        }
      };

      mediaRecorder.stop();
    });
  }, [isListening, languageCode, onTranscript, onError, cleanup]);

  return {
    isListening,
    isProcessing,
    error,
    isSupported,
    startListening,
    stopListening,
  };
}

export default useVoiceInput;
