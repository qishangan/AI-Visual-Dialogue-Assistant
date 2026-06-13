package com.deepseek.aivisualdialogue;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Queue;

final class TtsPlayer {
    private static final String TAG = "TtsPlayer";

    interface PlaybackListener {
        void onPlaybackStateChanged(boolean playing);
    }

    private final Context context;
    private final PlaybackListener playbackListener;
    private final Queue<byte[]> queue = new ArrayDeque<>();
    private MediaPlayer mediaPlayer;
    private File currentFile;
    private boolean playing;

    TtsPlayer(Context context, PlaybackListener playbackListener) {
        this.context = context.getApplicationContext();
        this.playbackListener = playbackListener;
    }

    synchronized void play(byte[] audioBytes) {
        stop();
        enqueue(audioBytes);
    }

    synchronized void playChunks(List<byte[]> audioChunks) {
        stop();
        if (audioChunks == null) {
            return;
        }
        for (byte[] chunk : audioChunks) {
            if (chunk != null && chunk.length > 0) {
                queue.offer(chunk);
            }
        }
        if (!playing) {
            playNextLocked();
        }
    }

    synchronized void enqueue(byte[] audioBytes) {
        if (audioBytes == null || audioBytes.length == 0) {
            return;
        }
        queue.offer(audioBytes);
        if (!playing) {
            playNextLocked();
        }
    }

    synchronized void stop() {
        queue.clear();
        setPlayingLocked(false);
        releaseCurrentLocked();
    }

    private void playNextLocked() {
        releaseCurrentLocked();
        byte[] audioBytes = queue.poll();
        if (audioBytes == null) {
            setPlayingLocked(false);
            return;
        }

        setPlayingLocked(true);
        try {
            currentFile = File.createTempFile("dashscope_tts_", ".mp3", context.getCacheDir());
            try (FileOutputStream out = new FileOutputStream(currentFile)) {
                out.write(audioBytes);
            }

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            mediaPlayer.setDataSource(currentFile.getAbsolutePath());
            mediaPlayer.setOnPreparedListener(player -> {
                try {
                    player.start();
                } catch (Throwable error) {
                    Log.w(TAG, "TTS playback start failed", error);
                    synchronized (TtsPlayer.this) {
                        playNextLocked();
                    }
                }
            });
            mediaPlayer.setOnCompletionListener(player -> {
                synchronized (TtsPlayer.this) {
                    playNextLocked();
                }
            });
            mediaPlayer.setOnErrorListener((player, what, extra) -> {
                synchronized (TtsPlayer.this) {
                    playNextLocked();
                }
                return true;
            });
            mediaPlayer.prepareAsync();
        } catch (Throwable error) {
            Log.w(TAG, "TTS playback prepare failed", error);
            playNextLocked();
        }
    }

    private void setPlayingLocked(boolean value) {
        if (playing == value) {
            return;
        }
        playing = value;
        if (playbackListener != null) {
            try {
                playbackListener.onPlaybackStateChanged(value);
            } catch (Throwable error) {
                Log.w(TAG, "TTS playback listener failed", error);
            }
        }
    }

    private void releaseCurrentLocked() {
        if (mediaPlayer != null) {
            try {
                mediaPlayer.stop();
            } catch (Throwable ignored) {
            }
            try {
                mediaPlayer.release();
            } catch (Throwable ignored) {
            }
            mediaPlayer = null;
        }
        if (currentFile != null) {
            //noinspection ResultOfMethodCallIgnored
            currentFile.delete();
            currentFile = null;
        }
    }
}
