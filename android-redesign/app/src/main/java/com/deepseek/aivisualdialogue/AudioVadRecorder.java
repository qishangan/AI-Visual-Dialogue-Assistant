package com.deepseek.aivisualdialogue;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;

import java.io.ByteArrayOutputStream;

final class AudioVadRecorder {
    interface Listener {
        void onSpeechStart();

        void onSpeechEnd(byte[] pcm16Le);

        void onError(String message);
    }

    static final int SAMPLE_RATE = 16000;

    private static final double VOICE_THRESHOLD = 0.018d;
    private static final long SILENCE_TIMEOUT_MS = 1300L;
    private static final long START_CONFIRM_MS = 300L;
    private static final long MIN_SPEECH_MS = 800L;
    private static final long MIN_VOICED_MS = 450L;
    private static final long MAX_SPEECH_MS = 30_000L;

    private final Listener listener;
    private volatile boolean running;
    private AudioRecord audioRecord;
    private Thread workerThread;

    AudioVadRecorder(Listener listener) {
        this.listener = listener;
    }

    synchronized void start() {
        if (running) {
            return;
        }

        int minBuffer = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuffer <= 0) {
            listener.onError("麦克风不可用");
            return;
        }

        int readBufferSize = Math.max(minBuffer, SAMPLE_RATE / 5 * 2);
        int recordBufferSize = readBufferSize * 2;

        try {
            audioRecord = new AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    recordBufferSize
            );
        } catch (SecurityException error) {
            listener.onError("没有录音权限");
            return;
        } catch (IllegalArgumentException error) {
            listener.onError("录音初始化失败");
            return;
        }

        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            releaseRecorder();
            listener.onError("录音初始化失败");
            return;
        }

        running = true;
        workerThread = new Thread(() -> recordLoop(readBufferSize), "audio-vad-recorder");
        workerThread.start();
    }

    synchronized void stop() {
        running = false;
        if (workerThread != null) {
            workerThread.interrupt();
            workerThread = null;
        }
        releaseRecorder();
    }

    boolean isRunning() {
        return running;
    }

    private void recordLoop(int readBufferSize) {
        byte[] buffer = new byte[readBufferSize];
        ByteArrayOutputStream speechBuffer = new ByteArrayOutputStream();
        boolean inSpeech = false;
        boolean confirmedSpeech = false;
        long speechStartedAt = 0L;
        long lastVoiceAt = 0L;
        long voicedDurationMs = 0L;

        try {
            audioRecord.startRecording();
        } catch (IllegalStateException error) {
            running = false;
            listener.onError("录音启动失败");
            return;
        }

        while (running) {
            int read = audioRecord.read(buffer, 0, buffer.length);
            if (read <= 0) {
                continue;
            }

            long now = SystemClock.elapsedRealtime();
            long chunkDurationMs = Math.max(1L, read * 1000L / (SAMPLE_RATE * 2L));
            boolean voiced = calculateRms(buffer, read) >= VOICE_THRESHOLD;

            if (!inSpeech && voiced) {
                inSpeech = true;
                confirmedSpeech = false;
                speechBuffer.reset();
                speechStartedAt = now;
                lastVoiceAt = now;
                voicedDurationMs = chunkDurationMs;
                speechBuffer.write(buffer, 0, read);
                if (voicedDurationMs >= START_CONFIRM_MS) {
                    confirmedSpeech = true;
                    listener.onSpeechStart();
                }
                continue;
            }

            if (!inSpeech) {
                continue;
            }

            speechBuffer.write(buffer, 0, read);
            if (voiced) {
                lastVoiceAt = now;
                voicedDurationMs += chunkDurationMs;
                if (!confirmedSpeech && voicedDurationMs >= START_CONFIRM_MS) {
                    confirmedSpeech = true;
                    listener.onSpeechStart();
                }
            }

            boolean enoughSpeech = now - speechStartedAt >= MIN_SPEECH_MS;
            boolean silenceEnded = enoughSpeech && now - lastVoiceAt >= SILENCE_TIMEOUT_MS;
            boolean tooLong = now - speechStartedAt >= MAX_SPEECH_MS;
            if (silenceEnded || tooLong) {
                byte[] pcm = speechBuffer.toByteArray();
                long speechDurationMs = now - speechStartedAt;
                inSpeech = false;
                confirmedSpeech = false;
                speechBuffer.reset();
                if (speechDurationMs >= MIN_SPEECH_MS
                        && voicedDurationMs >= MIN_VOICED_MS
                        && pcm.length >= SAMPLE_RATE / 2 * 2) {
                    listener.onSpeechEnd(pcm);
                }
                voicedDurationMs = 0L;
            }
        }
    }

    private static double calculateRms(byte[] buffer, int read) {
        long sumSquares = 0L;
        int sampleCount = read / 2;
        if (sampleCount == 0) {
            return 0d;
        }

        for (int i = 0; i + 1 < read; i += 2) {
            int low = buffer[i] & 0xff;
            int high = buffer[i + 1];
            short sample = (short) ((high << 8) | low);
            sumSquares += (long) sample * sample;
        }

        double mean = sumSquares / (double) sampleCount;
        return Math.sqrt(mean) / 32768d;
    }

    private void releaseRecorder() {
        if (audioRecord == null) {
            return;
        }
        try {
            if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                audioRecord.stop();
            }
        } catch (IllegalStateException ignored) {
        }
        audioRecord.release();
        audioRecord = null;
    }
}
