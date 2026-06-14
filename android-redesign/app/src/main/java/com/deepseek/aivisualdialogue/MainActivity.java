package com.deepseek.aivisualdialogue;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Future;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class MainActivity extends Activity {
    private static final String TAG = "AIVisualDialogue";
    private static final int REQUEST_PERMISSIONS = 42;

    private static final int COLOR_BACKGROUND = Color.rgb(246, 248, 251);
    private static final int COLOR_SURFACE = Color.WHITE;
    private static final int COLOR_TEXT = Color.rgb(30, 44, 54);
    private static final int COLOR_TEXT_MUTED = Color.rgb(105, 121, 133);
    private static final int COLOR_PRIMARY = Color.rgb(28, 124, 125);
    private static final int COLOR_PRIMARY_DARK = Color.rgb(18, 86, 88);
    private static final int COLOR_CORAL = Color.rgb(224, 105, 91);
    private static final int COLOR_ASSISTANT = Color.rgb(238, 242, 245);
    private static final int MAX_SNAPSHOT_SIDE_PX = 1280;
    private static final int THUMBNAIL_MAX_SIDE_PX = 320;
    private static final long IMAGE_DESCRIPTION_TIMEOUT_MS = 6000L;
    private static final long TTS_ECHO_COOLDOWN_MS = 900L;
    private static final long STREAM_UI_UPDATE_INTERVAL_MS = 80L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService visionWorker = Executors.newFixedThreadPool(2);
    private final ExecutorService ttsWorker = Executors.newSingleThreadExecutor();
    private final List<ChatMessage> messages = new ArrayList<>();
    private final Map<String, TextView> messageTextViews = new HashMap<>();
    private final Map<String, Button> replayButtons = new HashMap<>();
    private final Object streamUiUpdateLock = new Object();

    private TextureView cameraTextureView;
    private SelectionOverlayView selectionOverlay;
    private LinearLayout chatList;
    private ScrollView chatScrollView;
    private TextView emptyStateView;
    private TextView statusBadge;
    private TextView statusLine;
    private Button listenButton;
    private Button ttsButton;
    private Button clearButton;

    private CameraPreviewController cameraController;
    private AudioVadRecorder audioVadRecorder;
    private DashScopeClient dashScopeClient;
    private DeepSeekClient deepSeekClient;
    private TtsPlayer ttsPlayer;

    private volatile boolean listening;
    private volatile boolean processing;
    private volatile boolean ttsEnabled = true;
    private volatile boolean ttsPlaybackActive;
    private volatile int ttsSession;
    private volatile int resumeAudioInputToken;
    private volatile long ignoreSpeechInputUntilMs;
    private volatile boolean streamUiUpdatePending;
    private volatile long lastStreamUiUpdateAtMs;
    private boolean cameraPermissionRequested;
    private volatile String currentSnapshotDataUrl;
    private volatile Future<String> pendingImageDescriptionFuture;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();

        dashScopeClient = new DashScopeClient(BuildConfig.DASHSCOPE_API_KEY);
        deepSeekClient = new DeepSeekClient(BuildConfig.DEEPSEEK_API_KEY);
        ttsPlayer = new TtsPlayer(this, playing -> {
            ttsPlaybackActive = playing;
            ignoreSpeechInputUntilMs = SystemClock.elapsedRealtime() + TTS_ECHO_COOLDOWN_MS;
            if (playing) {
                resumeAudioInputToken++;
            }
            postToMain(() -> handleTtsPlaybackStateChanged(playing));
        });

        buildUi();

        cameraController = new CameraPreviewController(this, message -> postToMain(() -> {
            setStatus("相机不可用：" + message, "相机异常", COLOR_CORAL);
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        }));
        cameraController.attach(cameraTextureView);

        audioVadRecorder = new AudioVadRecorder(new AudioVadRecorder.Listener() {
            @Override
            public void onSpeechStart() {
                if (shouldIgnoreSpeechInput()) {
                    return;
                }
                postToMain(MainActivity.this::handleSpeechStart);
            }

            @Override
            public void onSpeechEnd(byte[] pcm16Le) {
                if (shouldIgnoreSpeechInput()) {
                    return;
                }
                processSpeech(pcm16Le);
            }

            @Override
            public void onError(String message) {
                postToMain(() -> {
                    pauseListening();
                    setStatus(message, "麦克风异常", COLOR_CORAL);
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                });
            }
        });

        if (!hasMicPermission()) {
            requestRequiredPermissions();
        } else {
            if (hasCameraPermission()) {
                cameraController.open();
            }
            setStatus("监听已启动，直接说话", "监听中", COLOR_PRIMARY);
            startListening();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (cameraController != null && hasCameraPermission()) {
            cameraController.open();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        pauseListening();
        ttsSession++;
        cancelPendingImageDescription();
        if (cameraController != null) {
            cameraController.close();
        }
        if (ttsPlayer != null) {
            ttsPlayer.stop();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        worker.shutdownNow();
        visionWorker.shutdownNow();
        ttsWorker.shutdownNow();
        if (audioVadRecorder != null) {
            audioVadRecorder.stop();
        }
        if (cameraController != null) {
            cameraController.close();
        }
        if (ttsPlayer != null) {
            ttsPlayer.stop();
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_PERMISSIONS) {
            return;
        }
        if (hasCameraPermission()) {
            cameraController.open();
        }
        if (hasMicPermission()) {
            setStatus("监听已启动，直接说话", "监听中", COLOR_PRIMARY);
            startListening();
        } else {
            setStatus("需要麦克风权限才能监听", "缺少权限", COLOR_CORAL);
        }
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(COLOR_BACKGROUND);
        window.setNavigationBarColor(COLOR_SURFACE);
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(COLOR_BACKGROUND);
        root.setPadding(dp(12), dp(10), dp(12), dp(10));
        setContentView(root);

        FrameLayout cameraCard = new FrameLayout(this);
        cameraCard.setBackground(rounded(COLOR_TEXT, dp(18)));
        cameraCard.setClipToOutline(true);
        cameraCard.setElevation(dp(3));
        LinearLayout.LayoutParams cameraParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                5.2f
        );
        cameraParams.setMargins(0, 0, 0, dp(10));
        root.addView(cameraCard, cameraParams);

        cameraTextureView = new TextureView(this);
        cameraCard.addView(cameraTextureView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        selectionOverlay = new SelectionOverlayView(this);
        cameraCard.addView(selectionOverlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        LinearLayout cameraHeader = new LinearLayout(this);
        cameraHeader.setOrientation(LinearLayout.VERTICAL);
        cameraHeader.setGravity(Gravity.START);
        cameraHeader.setPadding(dp(12), dp(10), dp(12), dp(10));
        FrameLayout.LayoutParams headerParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.START | Gravity.TOP
        );
        cameraCard.addView(cameraHeader, headerParams);

        TextView title = new TextView(this);
        title.setText("AI Visual Dialogue");
        title.setTextColor(Color.WHITE);
        title.setTextSize(17);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setShadowLayer(6f, 0f, 2f, Color.argb(120, 0, 0, 0));
        cameraHeader.addView(title);

        statusBadge = new TextView(this);
        statusBadge.setTextSize(12);
        statusBadge.setTextColor(Color.WHITE);
        statusBadge.setPadding(dp(10), dp(4), dp(10), dp(4));
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        badgeParams.setMargins(0, dp(7), 0, 0);
        cameraHeader.addView(statusBadge, badgeParams);

        FrameLayout chatCard = new FrameLayout(this);
        chatCard.setBackground(rounded(COLOR_SURFACE, dp(18)));
        chatCard.setElevation(dp(2));
        LinearLayout.LayoutParams chatParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                4.1f
        );
        chatParams.setMargins(0, 0, 0, dp(10));
        root.addView(chatCard, chatParams);

        chatScrollView = new ScrollView(this);
        chatScrollView.setFillViewport(true);
        chatCard.addView(chatScrollView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        chatList = new LinearLayout(this);
        chatList.setOrientation(LinearLayout.VERTICAL);
        chatList.setPadding(dp(12), dp(12), dp(12), dp(12));
        chatScrollView.addView(chatList, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        emptyStateView = new TextView(this);
        emptyStateView.setText("开始监听后直接提问；需要看题时，可先框选画面区域。");
        emptyStateView.setTextColor(COLOR_TEXT_MUTED);
        emptyStateView.setTextSize(14);
        emptyStateView.setGravity(Gravity.CENTER);
        emptyStateView.setPadding(dp(24), dp(34), dp(24), dp(34));
        chatList.addView(emptyStateView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackground(rounded(COLOR_SURFACE, dp(18)));
        bottom.setPadding(dp(12), dp(10), dp(12), dp(10));
        bottom.setElevation(dp(2));
        root.addView(bottom, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        statusLine = new TextView(this);
        statusLine.setTextColor(COLOR_TEXT_MUTED);
        statusLine.setTextSize(13);
        statusLine.setSingleLine(true);
        statusLine.setEllipsize(TextUtils.TruncateAt.END);
        bottom.addView(statusLine, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams controlsParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48)
        );
        controlsParams.setMargins(0, dp(8), 0, 0);
        bottom.addView(controls, controlsParams);

        listenButton = button("开始", COLOR_PRIMARY, Color.WHITE);
        listenButton.setOnClickListener(v -> {
            if (listening) {
                pauseListening();
            } else {
                startListening();
            }
        });
        LinearLayout.LayoutParams listenParams = new LinearLayout.LayoutParams(0, dp(46), 1f);
        controls.addView(listenButton, listenParams);

        ttsButton = button("朗读 开", Color.rgb(235, 249, 246), COLOR_PRIMARY_DARK);
        ttsButton.setOnClickListener(v -> {
            ttsEnabled = !ttsEnabled;
            if (!ttsEnabled) {
                ttsSession++;
                ttsPlayer.stop();
            }
            updateControls();
        });
        LinearLayout.LayoutParams smallParams = new LinearLayout.LayoutParams(dp(88), dp(46));
        smallParams.setMargins(dp(8), 0, 0, 0);
        controls.addView(ttsButton, smallParams);

        clearButton = button("清空", Color.rgb(245, 247, 249), COLOR_TEXT_MUTED);
        clearButton.setOnClickListener(v -> clearConversation());
        LinearLayout.LayoutParams clearParams = new LinearLayout.LayoutParams(dp(76), dp(46));
        clearParams.setMargins(dp(8), 0, 0, 0);
        controls.addView(clearButton, clearParams);

        updateControls();
    }

    private void startListening() {
        if (processing) {
            return;
        }
        if (!dashScopeClient.hasApiKey()) {
            Toast.makeText(this, "请先在 local.properties 配置 DASHSCOPE_API_KEY", Toast.LENGTH_LONG).show();
            setStatus("缺少 DashScope API Key", "未配置", COLOR_CORAL);
            return;
        }
        if (!deepSeekClient.hasApiKey()) {
            Toast.makeText(this, "请先在 local.properties 配置 DEEPSEEK_API_KEY", Toast.LENGTH_LONG).show();
            setStatus("缺少 DeepSeek API Key", "未配置", COLOR_CORAL);
            return;
        }
        if (!hasMicPermission()) {
            requestRequiredPermissions();
            return;
        }
        if (hasCameraPermission()) {
            cameraController.open();
        } else {
            requestCameraPermissionIfNeeded();
        }
        listening = true;
        if (shouldIgnoreSpeechInput()) {
            updateControls();
            setStatus("AI 正在朗读，结束后自动继续监听", "朗读中", COLOR_PRIMARY);
            scheduleResumeAudioInput();
            return;
        }
        audioVadRecorder.start();
        if (audioVadRecorder.isRunning()) {
            updateControls();
            setStatus("待机中，直接说话", "监听中", COLOR_PRIMARY);
        }
    }

    private void pauseListening() {
        listening = false;
        resumeAudioInputToken++;
        if (audioVadRecorder != null) {
            audioVadRecorder.stop();
        }
        updateControls();
        if (!processing) {
            setStatus("已暂停", "暂停", COLOR_TEXT_MUTED);
        }
    }

    private void handleSpeechStart() {
        if (processing || shouldIgnoreSpeechInput()) {
            return;
        }
        ttsSession++;
        ttsPlayer.stop();
        currentSnapshotDataUrl = captureSnapshotDataUrl();
        startImageDescriptionTask(currentSnapshotDataUrl);
        setStatus("正在听，请说完后停顿一下", "听取中", COLOR_CORAL);
    }

    private void processSpeech(byte[] pcm16Le) {
        if (processing || shouldIgnoreSpeechInput()) {
            return;
        }
        processing = true;
        postToMain(() -> {
            stopAudioInput();
            selectionOverlay.setLocked(true);
            updateControls();
            setStatus("正在识别语音", "识别中", COLOR_CORAL);
        });

        worker.execute(() -> {
            ChatMessage[] assistantRef = new ChatMessage[1];
            try {
                String userText = dashScopeClient.recognizeSpeech(pcm16Le);
                if (userText == null || userText.trim().isEmpty()) {
                    postToMain(() -> Toast.makeText(this, "没有听清，请再说一次", Toast.LENGTH_SHORT).show());
                    return;
                }
                if (shouldIgnoreTranscription(userText)) {
                    return;
                }

                List<ChatMessage> history = snapshotMessages();
                String imageDataUrl = currentSnapshotDataUrl;
                if (imageDataUrl != null) {
                    postToMain(() -> setStatus("正在理解画面", "识图中", COLOR_CORAL));
                }
                String imageDescription = awaitImageDescription();
                if (imageDataUrl != null && imageDescription.isEmpty()) {
                    Log.w(TAG, "No visual transcription available for current turn");
                }
                ChatMessage userMessage = new ChatMessage(
                        ChatMessage.Role.USER,
                        userText,
                        imageDataUrl,
                        imageDescription
                );
                ChatMessage assistantMessage = new ChatMessage(ChatMessage.Role.ASSISTANT, "", null);
                assistantRef[0] = assistantMessage;

                runOnUiThreadSync(() -> {
                    addMessage(userMessage);
                    addMessage(assistantMessage);
                    setStatus("AI 正在回答", "回复中", COLOR_PRIMARY);
                });

                StringBuilder fullText = new StringBuilder();
                StringBuilder ttsTextBuffer = new StringBuilder();
                int session = ttsSession;
                String finalText = deepSeekClient.streamAnswer(
                        history,
                        userText,
                        imageDescription,
                        delta -> {
                            fullText.append(delta);
                            assistantMessage.text = fullText.toString();
                            scheduleMessageTextUpdate(assistantMessage, false);
                            feedStreamingTts(delta, assistantMessage, ttsTextBuffer, session);
                        }
                );

                if (finalText.trim().isEmpty()) {
                    finalText = fullText.toString();
                }
                if (finalText.trim().isEmpty()) {
                    finalText = "我这边没有收到有效回复，请再试一次。";
                }

                String completedText = finalText;
                assistantMessage.text = completedText;
                scheduleMessageTextUpdate(assistantMessage, true);
                flushStreamingTts(assistantMessage, ttsTextBuffer, session);
            } catch (Throwable error) {
                String message = compactError(error);
                ChatMessage assistant = assistantRef[0];
                postToMain(() -> {
                    if (assistant != null) {
                        if (assistant.text == null || assistant.text.trim().isEmpty()) {
                            assistant.text = "处理失败：" + message;
                            updateMessageText(assistant.id, assistant.text);
                        }
                    }
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                });
            } finally {
                processing = false;
                cancelPendingImageDescription();
                currentSnapshotDataUrl = null;
                postToMain(() -> {
                    selectionOverlay.setLocked(false);
                    updateControls();
                    if (listening) {
                        if (ttsPlaybackActive || SystemClock.elapsedRealtime() < ignoreSpeechInputUntilMs) {
                            setStatus("AI 正在朗读，结束后自动继续监听", "朗读中", COLOR_PRIMARY);
                        } else {
                            setStatus("待机中，直接说话", "监听中", COLOR_PRIMARY);
                        }
                        scheduleResumeAudioInput();
                    } else {
                        setStatus("已暂停", "暂停", COLOR_TEXT_MUTED);
                    }
                });
            }
        });
    }

    private boolean shouldIgnoreSpeechInput() {
        return processing
                || ttsPlaybackActive
                || SystemClock.elapsedRealtime() < ignoreSpeechInputUntilMs;
    }

    private void handleTtsPlaybackStateChanged(boolean playing) {
        if (playing) {
            stopAudioInput();
            if (listening && !processing) {
                setStatus("AI 正在朗读，结束后自动继续监听", "朗读中", COLOR_PRIMARY);
            }
        } else {
            scheduleResumeAudioInput();
        }
    }

    private void stopAudioInput() {
        if (audioVadRecorder != null && audioVadRecorder.isRunning()) {
            audioVadRecorder.stop();
        }
    }

    private void scheduleResumeAudioInput() {
        if (!listening || processing || ttsPlaybackActive) {
            return;
        }
        int token = ++resumeAudioInputToken;
        long delayMs = Math.max(0L, ignoreSpeechInputUntilMs - SystemClock.elapsedRealtime());
        postToMainDelayed(() -> {
            if (token != resumeAudioInputToken || !listening) {
                return;
            }
            if (processing || ttsPlaybackActive) {
                return;
            }
            if (SystemClock.elapsedRealtime() < ignoreSpeechInputUntilMs) {
                scheduleResumeAudioInput();
                return;
            }
            if (audioVadRecorder != null && !audioVadRecorder.isRunning()) {
                audioVadRecorder.start();
            }
            if (audioVadRecorder != null && audioVadRecorder.isRunning()) {
                updateControls();
                setStatus("待机中，直接说话", "监听中", COLOR_PRIMARY);
            }
        }, delayMs);
    }

    private void startImageDescriptionTask(String imageDataUrl) {
        cancelPendingImageDescription();
        if (imageDataUrl == null || imageDataUrl.trim().isEmpty()) {
            Log.w(TAG, "Vision transcription skipped: no camera snapshot");
            return;
        }
        if (!dashScopeClient.hasApiKey()) {
            Log.w(TAG, "Vision transcription skipped: missing DashScope API key");
            return;
        }
        Log.i(TAG, "Vision transcription started, snapshot chars=" + imageDataUrl.length());
        pendingImageDescriptionFuture = visionWorker.submit(() -> {
            try {
                String description = dashScopeClient.describeImage(imageDataUrl);
                String normalized = description == null ? "" : description.trim();
                if (normalized.isEmpty()) {
                    Log.w(TAG, "Vision transcription returned empty text");
                } else {
                    Log.i(TAG, "Vision transcription completed, chars=" + normalized.length());
                }
                return normalized;
            } catch (Throwable error) {
                Log.w(TAG, "Vision transcription failed", error);
                return "";
            }
        });
    }

    private String awaitImageDescription() {
        Future<String> future = pendingImageDescriptionFuture;
        pendingImageDescriptionFuture = null;
        if (future == null) {
            return "";
        }
        try {
            String result = future.get(IMAGE_DESCRIPTION_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            return result == null ? "" : result.trim();
        } catch (java.util.concurrent.TimeoutException error) {
            Log.w(TAG, "Vision transcription timed out after " + IMAGE_DESCRIPTION_TIMEOUT_MS + "ms");
            future.cancel(true);
            return "";
        } catch (java.util.concurrent.ExecutionException error) {
            Log.w(TAG, "Vision transcription task failed", error.getCause());
            return "";
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return "";
        }
    }

    private void cancelPendingImageDescription() {
        Future<String> future = pendingImageDescriptionFuture;
        pendingImageDescriptionFuture = null;
        if (future != null && !future.isDone()) {
            future.cancel(true);
        }
    }

    private boolean shouldIgnoreTranscription(String text) {
        String normalized = text == null
                ? ""
                : text.replaceAll("[\\s，。！？!?、,.…]+", "").trim();
        if (normalized.isEmpty()) {
            return true;
        }

        String[] noiseTexts = {"嗯", "啊", "呃", "额", "咳", "咳咳", "咳嗽", "哼", "喂"};
        for (String noise : noiseTexts) {
            if (normalized.equals(noise)) {
                return true;
            }
        }
        return false;
    }

    private void feedStreamingTts(
            String delta,
            ChatMessage assistantMessage,
            StringBuilder ttsTextBuffer,
            int session
    ) {
        if (!ttsEnabled || delta == null || delta.isEmpty()) {
            return;
        }

        ttsTextBuffer.append(delta);
        while (true) {
            int boundary = findTtsBoundary(ttsTextBuffer);
            if (boundary <= 0) {
                return;
            }
            String sentence = ttsTextBuffer.substring(0, boundary).trim();
            ttsTextBuffer.delete(0, boundary);
            enqueueTtsSentence(sentence, assistantMessage, session);
        }
    }

    private void flushStreamingTts(
            ChatMessage assistantMessage,
            StringBuilder ttsTextBuffer,
            int session
    ) {
        if (!ttsEnabled) {
            ttsTextBuffer.setLength(0);
            return;
        }
        String rest = ttsTextBuffer.toString().trim();
        ttsTextBuffer.setLength(0);
        enqueueTtsSentence(rest, assistantMessage, session);
    }

    private int findTtsBoundary(StringBuilder text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if ("。！？!?；;\n".indexOf(c) >= 0) {
                return i + 1;
            }
            if (i >= 24 && "，,、".indexOf(c) >= 0) {
                return i + 1;
            }
        }
        return text.length() >= 64 ? text.length() : -1;
    }

    private void enqueueTtsSentence(String sentence, ChatMessage assistantMessage, int session) {
        String text = sentence == null ? "" : sentence.trim();
        if (text.isEmpty() || !ttsEnabled || session != ttsSession) {
            return;
        }

        ttsWorker.execute(() -> {
            if (!ttsEnabled || session != ttsSession) {
                return;
            }
            try {
                byte[] audioBytes = dashScopeClient.synthesizeSpeech(text);
                if (audioBytes == null || audioBytes.length == 0 || !ttsEnabled || session != ttsSession) {
                    return;
                }
                synchronized (assistantMessage.audioChunks) {
                    assistantMessage.audioChunks.add(audioBytes);
                    if (assistantMessage.audioBytes == null) {
                        assistantMessage.audioBytes = audioBytes;
                    }
                }
                postToMain(() -> updateReplayButton(assistantMessage.id));
                ttsPlayer.enqueue(audioBytes);
            } catch (Throwable error) {
                Log.w(TAG, "TTS sentence playback failed", error);
                // Text is already visible; a failed sentence synthesis should not interrupt the answer.
            }
        });
    }

    private List<ChatMessage> snapshotMessages() {
        synchronized (messages) {
            return new ArrayList<>(messages);
        }
    }

    private void addMessage(ChatMessage message) {
        synchronized (messages) {
            messages.add(message);
        }
        try {
            if (emptyStateView != null && emptyStateView.getParent() == chatList) {
                chatList.removeView(emptyStateView);
            }
            appendMessageView(message);
        } catch (Throwable error) {
            Log.e(TAG, "Message view render failed", error);
            appendFallbackMessageView(message);
        }
    }

    private void appendMessageView(ChatMessage message) {
        boolean isUser = message.role == ChatMessage.Role.USER;

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setGravity(isUser ? Gravity.END : Gravity.START);
        row.setPadding(0, dp(4), 0, dp(4));
        chatList.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        if (isUser && message.imageDataUrl != null) {
            Bitmap thumbnail = decodeImageDataUrl(message.imageDataUrl);
            if (thumbnail != null) {
                ImageView imageView = new ImageView(this);
                imageView.setImageBitmap(thumbnail);
                imageView.setScaleType(ImageView.ScaleType.CENTER_CROP);
                imageView.setBackground(rounded(Color.rgb(225, 232, 238), dp(12)));
                LinearLayout.LayoutParams imageParams = new LinearLayout.LayoutParams(dp(152), dp(96));
                imageParams.setMargins(0, 0, 0, dp(6));
                row.addView(imageView, imageParams);
            }
        }

        TextView bubble = new TextView(this);
        setMessageTextSafely(bubble, message.text);
        bubble.setTextSize(15);
        bubble.setLineSpacing(4f, 1.12f);
        bubble.setTextColor(isUser ? Color.WHITE : COLOR_TEXT);
        bubble.setPadding(dp(13), dp(10), dp(13), dp(10));
        bubble.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.76f));
        bubble.setBackground(rounded(isUser ? COLOR_PRIMARY : COLOR_ASSISTANT, dp(14)));
        row.addView(bubble, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        messageTextViews.put(message.id, bubble);

        if (!isUser) {
            Button replayButton = button("▶", Color.rgb(245, 247, 249), COLOR_PRIMARY);
            replayButton.setContentDescription("重播语音");
            replayButton.setTextSize(13);
            replayButton.setVisibility(hasAudio(message) ? View.VISIBLE : View.GONE);
            replayButton.setOnClickListener(v -> {
                List<byte[]> chunks;
                synchronized (message.audioChunks) {
                    chunks = new ArrayList<>(message.audioChunks);
                }
                if (!chunks.isEmpty()) {
                    ttsPlayer.playChunks(chunks);
                } else if (message.audioBytes != null) {
                    ttsPlayer.play(message.audioBytes);
                }
            });
            LinearLayout.LayoutParams replayParams = new LinearLayout.LayoutParams(dp(42), dp(32));
            replayParams.setMargins(0, dp(5), 0, 0);
            row.addView(replayButton, replayParams);
            replayButtons.put(message.id, replayButton);
        }

        scrollToBottom();
    }

    private void appendFallbackMessageView(ChatMessage message) {
        try {
            boolean isUser = message.role == ChatMessage.Role.USER;
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setGravity(isUser ? Gravity.END : Gravity.START);
            row.setPadding(0, dp(4), 0, dp(4));
            chatList.addView(row, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            ));

            TextView bubble = new TextView(this);
            String text = message.text == null || message.text.isEmpty() ? "..." : message.text;
            bubble.setText(text);
            bubble.setTextSize(15);
            bubble.setLineSpacing(4f, 1.12f);
            bubble.setTextColor(isUser ? Color.WHITE : COLOR_TEXT);
            bubble.setPadding(dp(13), dp(10), dp(13), dp(10));
            bubble.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.76f));
            bubble.setBackground(rounded(isUser ? COLOR_PRIMARY : COLOR_ASSISTANT, dp(14)));
            row.addView(bubble, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            ));
            messageTextViews.put(message.id, bubble);
            scrollToBottom();
        } catch (Throwable fallbackError) {
            Log.e(TAG, "Fallback message view render failed", fallbackError);
        }
    }

    private void updateMessageText(String messageId, String text) {
        try {
            TextView textView = messageTextViews.get(messageId);
            if (textView != null) {
                setMessageTextSafely(textView, text);
            }
            scrollToBottom();
        } catch (Throwable error) {
            Log.e(TAG, "Message text update failed", error);
        }
    }

    private void setMessageTextSafely(TextView textView, String text) {
        String fallback = text == null || text.isEmpty() ? "..." : text;
        try {
            textView.setText(fallback);
        } catch (Throwable error) {
            Log.w(TAG, "Message text formatting failed", error);
            try {
                textView.setText(fallback);
            } catch (Throwable fallbackError) {
                Log.e(TAG, "Fallback text update failed", fallbackError);
            }
        }
    }

    private void scheduleMessageTextUpdate(ChatMessage message, boolean force) {
        if (message == null) {
            return;
        }
        if (force) {
            synchronized (streamUiUpdateLock) {
                streamUiUpdatePending = false;
                lastStreamUiUpdateAtMs = SystemClock.elapsedRealtime();
            }
            postToMain(() -> updateMessageText(message.id, message.text));
            return;
        }

        long delayMs;
        synchronized (streamUiUpdateLock) {
            long now = SystemClock.elapsedRealtime();
            long elapsed = now - lastStreamUiUpdateAtMs;
            if (!streamUiUpdatePending && elapsed >= STREAM_UI_UPDATE_INTERVAL_MS) {
                lastStreamUiUpdateAtMs = now;
                postToMain(() -> updateMessageText(message.id, message.text));
                return;
            }
            if (streamUiUpdatePending) {
                return;
            }
            streamUiUpdatePending = true;
            delayMs = Math.max(1L, STREAM_UI_UPDATE_INTERVAL_MS - elapsed);
        }

        postToMainDelayed(() -> {
            synchronized (streamUiUpdateLock) {
                streamUiUpdatePending = false;
                lastStreamUiUpdateAtMs = SystemClock.elapsedRealtime();
            }
            updateMessageText(message.id, message.text);
        }, delayMs);
    }

    private void updateReplayButton(String messageId) {
        Button replayButton = replayButtons.get(messageId);
        if (replayButton != null) {
            replayButton.setVisibility(View.VISIBLE);
        }
    }

    private boolean hasAudio(ChatMessage message) {
        if (message.audioBytes != null) {
            return true;
        }
        synchronized (message.audioChunks) {
            return !message.audioChunks.isEmpty();
        }
    }

    private void clearConversation() {
        ttsSession++;
        ttsPlayer.stop();
        cancelPendingImageDescription();
        synchronized (messages) {
            messages.clear();
        }
        messageTextViews.clear();
        replayButtons.clear();
        chatList.removeAllViews();
        chatList.addView(emptyStateView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        selectionOverlay.clearSelection();
        if (!processing) {
            setStatus(listening ? "待机中，直接说话" : "已暂停", listening ? "监听中" : "暂停",
                    listening ? COLOR_PRIMARY : COLOR_TEXT_MUTED);
        }
    }

    private String captureSnapshotDataUrl() {
        Bitmap bitmap = cameraController.captureBitmap();
        if (bitmap == null) {
            return null;
        }

        Bitmap target = bitmap;
        RectF selection = selectionOverlay.getSelectionRect();
        if (selection != null && selection.width() > 0 && selection.height() > 0) {
            float scaleX = bitmap.getWidth() / (float) Math.max(1, selectionOverlay.getWidth());
            float scaleY = bitmap.getHeight() / (float) Math.max(1, selectionOverlay.getHeight());
            int left = clamp(Math.round(selection.left * scaleX), 0, bitmap.getWidth() - 1);
            int top = clamp(Math.round(selection.top * scaleY), 0, bitmap.getHeight() - 1);
            int right = clamp(Math.round(selection.right * scaleX), left + 1, bitmap.getWidth());
            int bottom = clamp(Math.round(selection.bottom * scaleY), top + 1, bitmap.getHeight());
            target = Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top);
        }

        Bitmap uploadBitmap = scaleDownBitmap(target, MAX_SNAPSHOT_SIDE_PX);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        uploadBitmap.compress(Bitmap.CompressFormat.JPEG, 82, out);
        String dataUrl = "data:image/jpeg;base64," +
                Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        if (uploadBitmap != target) {
            uploadBitmap.recycle();
        }
        if (target != bitmap) {
            target.recycle();
        }
        bitmap.recycle();
        return dataUrl;
    }

    private Bitmap decodeImageDataUrl(String dataUrl) {
        if (dataUrl == null) {
            return null;
        }
        try {
            int comma = dataUrl.indexOf(',');
            if (comma < 0 || comma + 1 >= dataUrl.length()) {
                return null;
            }
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = calculateInSampleSize(
                    bounds.outWidth,
                    bounds.outHeight,
                    THUMBNAIL_MAX_SIDE_PX
            );
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (IllegalArgumentException | OutOfMemoryError error) {
            Log.w(TAG, "Thumbnail decode failed", error);
            return null;
        }
    }

    private Bitmap scaleDownBitmap(Bitmap source, int maxSidePx) {
        int width = source.getWidth();
        int height = source.getHeight();
        int maxSide = Math.max(width, height);
        if (maxSide <= maxSidePx) {
            return source;
        }
        float scale = maxSidePx / (float) maxSide;
        int targetWidth = Math.max(1, Math.round(width * scale));
        int targetHeight = Math.max(1, Math.round(height * scale));
        try {
            return Bitmap.createScaledBitmap(source, targetWidth, targetHeight, true);
        } catch (RuntimeException | OutOfMemoryError error) {
            Log.w(TAG, "Snapshot scale failed; using original bitmap", error);
            return source;
        }
    }

    private int calculateInSampleSize(int width, int height, int maxSidePx) {
        int sampleSize = 1;
        int maxSide = Math.max(width, height);
        while (maxSide / sampleSize > maxSidePx) {
            sampleSize *= 2;
        }
        return Math.max(1, sampleSize);
    }

    private boolean hasMicPermission() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasCameraPermission() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestRequiredPermissions() {
        List<String> permissions = new ArrayList<>();
        if (!hasMicPermission()) {
            permissions.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!hasCameraPermission()) {
            permissions.add(Manifest.permission.CAMERA);
            cameraPermissionRequested = true;
        }
        if (!permissions.isEmpty()) {
            requestPermissions(permissions.toArray(new String[0]), REQUEST_PERMISSIONS);
        }
    }

    private void requestCameraPermissionIfNeeded() {
        if (!hasCameraPermission() && !cameraPermissionRequested) {
            cameraPermissionRequested = true;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_PERMISSIONS);
        }
    }

    private void updateControls() {
        listenButton.setEnabled(!processing);
        listenButton.setText(listening ? "暂停" : "开始");
        listenButton.setBackground(rounded(listening ? COLOR_CORAL : COLOR_PRIMARY, dp(14)));
        ttsButton.setText(String.format(Locale.ROOT, "朗读 %s", ttsEnabled ? "开" : "关"));
        ttsButton.setTextColor(ttsEnabled ? COLOR_PRIMARY_DARK : COLOR_TEXT_MUTED);
        clearButton.setEnabled(!processing);
        clearButton.setAlpha(processing ? 0.45f : 1f);
    }

    private void setStatus(String line, String badge, int badgeColor) {
        statusLine.setText(line);
        statusBadge.setText(badge);
        statusBadge.setBackground(rounded(Color.argb(218, Color.red(badgeColor), Color.green(badgeColor), Color.blue(badgeColor)), dp(14)));
    }

    private void scrollToBottom() {
        chatScrollView.post(() -> chatScrollView.fullScroll(View.FOCUS_DOWN));
    }

    private Button button(String text, int backgroundColor, int textColor) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(text);
        button.setTextColor(textColor);
        button.setTextSize(14);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setPadding(dp(10), 0, dp(10), 0);
        button.setBackground(rounded(backgroundColor, dp(14)));
        return button;
    }

    private GradientDrawable rounded(int color, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private String compactError(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) {
            return "请求失败，请稍后重试";
        }
        return message.length() > 120 ? message.substring(0, 120) + "..." : message;
    }

    private void postToMain(Runnable runnable) {
        mainHandler.post(() -> runMainSafely(runnable));
    }

    private void postToMainDelayed(Runnable runnable, long delayMs) {
        mainHandler.postDelayed(() -> runMainSafely(runnable), delayMs);
    }

    private void runMainSafely(Runnable runnable) {
        try {
            if (isFinishing() || isDestroyed()) {
                return;
            }
            runnable.run();
        } catch (Throwable error) {
            Log.e(TAG, "Main thread task failed", error);
        }
    }

    private void runOnUiThreadSync(Runnable runnable) throws InterruptedException {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            runMainSafely(runnable);
            return;
        }
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Throwable> uiError = new AtomicReference<>();
        mainHandler.post(() -> {
            try {
                runnable.run();
            } catch (Throwable error) {
                uiError.set(error);
            } finally {
                latch.countDown();
            }
        });
        latch.await();
        Throwable error = uiError.get();
        if (error != null) {
            Log.e(TAG, "UI update failed", error);
        }
    }
}
