package com.deepseek.aivisualdialogue;

import android.text.TextUtils;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

final class DashScopeClient {
    interface StreamCallback {
        void onDelta(String delta);
    }

    private static final String CHAT_COMPLETIONS_URL =
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    private static final String TTS_URL =
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

    private static final String ASR_MODEL = "qwen3-asr-flash";
    private static final String VLM_MODEL = "qwen-vl-plus";
    private static final String TTS_MODEL = "qwen3-tts-flash";
    private static final String TTS_VOICE = "Cherry";
    private static final String TTS_LANGUAGE = "Chinese";
    private static final int MAX_HISTORY_MESSAGES = 12;
    private static final int CONTEXT_EXCERPT_MESSAGES = 6;

    private static final String SYSTEM_PROMPT =
            "你是一位耐心、友善的学习助手，帮助学生理解题目，而不是直接给出答案。\n" +
            "你会收到最近几轮对话历史，必须结合上下文理解学生的追问、代词和省略表达。\n" +
            "如果学生问“怎么来的”“为什么”“这一步呢”“这个呢”等短句，不要当成新问题，必须优先回看上一轮用户问题和助手回复，解释刚才提到的结果、步骤或概念。\n" +
            "系统每轮都可能附带一张自动截取的摄像头画面。图片可能与本轮问题有关，也可能完全无关；如果图片看起来不相关，请忽略图片，优先根据学生文字和上下文回答。\n" +
            "核心原则：\n" +
            "1. 不要直接说出最终答案或完整解题过程。\n" +
            "2. 第一轮对话时，先问“你觉得这道题考察的是什么知识点？”，鼓励学生自己思考。\n" +
            "3. 根据学生回答，每次只给一步提示。\n" +
            "4. 只有学生连续两次表示“不会”“不懂”“教教我”时，才给出更具体的第一步提示，但仍不触及最终答案。\n" +
            "5. 每次回复不超过 3 句话，保持简洁。\n" +
            "6. 数学题优先问已知条件；物理题优先问现象涉及什么原理；化学题优先问反应物和生成物；语文/英语优先问句子在说什么。\n" +
            "7. 当学生已经理解并正确解出题目时，给予肯定，然后主动问要不要试一道类似题。\n" +
            "语气像一位友善的同学，用“咱们”“你看”“试试看”等亲切表达。";

    private final String apiKey;

    DashScopeClient(String apiKey) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
    }

    boolean hasApiKey() {
        return !TextUtils.isEmpty(apiKey);
    }

    String describeImage(String imageDataUrl) throws IOException, JSONException {
        ensureApiKey();
        if (TextUtils.isEmpty(imageDataUrl)) {
            return "";
        }

        JSONArray content = new JSONArray()
                .put(new JSONObject()
                        .put("type", "text")
                        .put("text", "请只做图像转写，不要解题，不要回答用户问题。用中文客观、详细描述这张图片：整体场景、主要物体、可见文字、题目/公式/表格内容、布局位置和看不清的地方。输出信息密度高但不要啰嗦。"))
                .put(new JSONObject()
                        .put("type", "image_url")
                        .put("image_url", new JSONObject().put("url", imageDataUrl)));

        JSONArray messages = new JSONArray()
                .put(new JSONObject()
                        .put("role", "system")
                        .put("content", "你是视觉转写模型。你的任务是把图片内容转成客观文字描述，禁止直接解题、禁止给建议、禁止代替最终助手回答。"))
                .put(new JSONObject()
                        .put("role", "user")
                        .put("content", content));

        JSONObject body = new JSONObject()
                .put("model", VLM_MODEL)
                .put("messages", messages)
                .put("stream", false);

        return extractChoiceText(postJson(CHAT_COMPLETIONS_URL, body, false)).trim();
    }

    String recognizeSpeech(byte[] pcm16Le) throws IOException, JSONException {
        ensureApiKey();

        byte[] wav = WavEncoder.pcm16MonoToWav(pcm16Le, AudioVadRecorder.SAMPLE_RATE);
        String dataUrl = "data:audio/wav;base64," +
                Base64.encodeToString(wav, Base64.NO_WRAP);

        JSONObject audio = new JSONObject()
                .put("data", dataUrl);
        JSONObject contentItem = new JSONObject()
                .put("type", "input_audio")
                .put("input_audio", audio);
        JSONObject userMessage = new JSONObject()
                .put("role", "user")
                .put("content", new JSONArray().put(contentItem));

        JSONObject body = new JSONObject()
                .put("model", ASR_MODEL)
                .put("messages", new JSONArray().put(userMessage))
                .put("stream", false);

        JSONObject response = postJson(CHAT_COMPLETIONS_URL, body, false);
        String directText = response.optString("text", "").trim();
        if (!directText.isEmpty()) {
            return directText;
        }

        JSONArray choices = response.optJSONArray("choices");
        if (choices != null && choices.length() > 0) {
            JSONObject message = choices.optJSONObject(0).optJSONObject("message");
            if (message != null) {
                Object content = message.opt("content");
                if (content instanceof String) {
                    return ((String) content).trim();
                }
                if (content != null) {
                    return content.toString().trim();
                }
            }
        }
        throw new IOException("ASR 返回异常：" + response);
    }

    String streamChat(
            List<ChatMessage> history,
            String userText,
            String imageDataUrl,
            StreamCallback callback
    ) throws IOException, JSONException {
        ensureApiKey();

        JSONObject body = new JSONObject()
                .put("model", VLM_MODEL)
                .put("messages", buildMessages(history, userText, imageDataUrl))
                .put("stream", true)
                .put("stream_options", new JSONObject().put("include_usage", true));

        HttpURLConnection connection = openPostConnection(CHAT_COMPLETIONS_URL, true);
        try {
            writeJson(connection, body);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("VLM 请求失败 (" + status + "): " + readError(connection));
            }

            StringBuilder fullText = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    connection.getInputStream(),
                    StandardCharsets.UTF_8
            ))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) {
                        continue;
                    }
                    String data = trimmed.substring(5).trim();
                    if (data.isEmpty()) {
                        continue;
                    }
                    if ("[DONE]".equals(data)) {
                        break;
                    }

                    String delta = extractDelta(data);
                    if (!delta.isEmpty()) {
                        fullText.append(delta);
                        callback.onDelta(delta);
                    }
                }
            }
            return fullText.toString();
        } finally {
            connection.disconnect();
        }
    }

    byte[] synthesizeSpeech(String text) throws IOException, JSONException {
        ensureApiKey();
        if (text == null || text.trim().isEmpty()) {
            return new byte[0];
        }

        JSONObject input = new JSONObject()
                .put("text", text)
                .put("voice", TTS_VOICE)
                .put("language_type", TTS_LANGUAGE);
        JSONObject body = new JSONObject()
                .put("model", TTS_MODEL)
                .put("input", input);

        HttpURLConnection connection = openPostConnection(TTS_URL, false);
        connection.setRequestProperty("X-DashScope-SSE", "enable");
        try {
            writeJson(connection, body);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("TTS 合成失败 (" + status + "): " + readError(connection));
            }

            String contentType = connection.getContentType();
            if (contentType != null && contentType.contains("text/event-stream")) {
                return parseTtsStream(connection.getInputStream());
            }

            byte[] raw = readAll(connection.getInputStream());
            if (contentType != null && contentType.contains("application/json")) {
                return parseTtsJson(new JSONObject(new String(raw, StandardCharsets.UTF_8)));
            }
            return raw;
        } finally {
            connection.disconnect();
        }
    }

    private JSONArray buildMessages(List<ChatMessage> history, String userText, String imageDataUrl)
            throws JSONException {
        JSONArray messages = new JSONArray()
                .put(new JSONObject()
                        .put("role", "system")
                        .put("content", SYSTEM_PROMPT));

        int start = Math.max(0, history.size() - MAX_HISTORY_MESSAGES);
        for (int i = start; i < history.size(); i++) {
            ChatMessage message = history.get(i);
            if (message.text == null || message.text.trim().isEmpty()) {
                continue;
            }
            messages.put(new JSONObject()
                    .put("role", message.role == ChatMessage.Role.USER ? "user" : "assistant")
                    .put("content", message.text));
        }

        String contextExcerpt = buildContextExcerpt(history);
        if (!contextExcerpt.isEmpty()) {
            messages.put(new JSONObject()
                    .put("role", "system")
                    .put("content", "最近对话摘录如下。当前问题如果是追问、代词或省略表达，必须优先依据这段上下文回答，不要把它当成全新的独立问题。\n" + contextExcerpt));
        }

        if (!TextUtils.isEmpty(imageDataUrl)) {
            String visualText = "学生本轮问题：" + userText + "\n\n" +
                    "如果本轮问题是“怎么来的”“为什么”“这一步呢”等追问，请优先解释最近对话里刚提到的结果、步骤或概念。\n\n" +
                    "随附图片是自动截取的当前摄像头画面，可能相关也可能无关；如果无关，请忽略图片并结合上下文回答。";
            JSONArray content = new JSONArray()
                    .put(new JSONObject()
                            .put("type", "text")
                            .put("text", visualText))
                    .put(new JSONObject()
                            .put("type", "image_url")
                            .put("image_url", new JSONObject().put("url", imageDataUrl)));
            messages.put(new JSONObject()
                    .put("role", "user")
                    .put("content", content));
        } else {
            messages.put(new JSONObject()
                    .put("role", "user")
                    .put("content", userText));
        }

        return messages;
    }

    private String buildContextExcerpt(List<ChatMessage> history) {
        StringBuilder excerpt = new StringBuilder();
        int start = Math.max(0, history.size() - CONTEXT_EXCERPT_MESSAGES);
        for (int i = start; i < history.size(); i++) {
            ChatMessage message = history.get(i);
            if (message.text == null || message.text.trim().isEmpty()) {
                continue;
            }
            excerpt.append(message.role == ChatMessage.Role.USER ? "学生：" : "助手：")
                    .append(trimForContext(message.text))
                    .append('\n');
        }
        return excerpt.toString().trim();
    }

    private String trimForContext(String text) {
        String normalized = text.replace('\n', ' ').trim();
        if (normalized.length() <= 180) {
            return normalized;
        }
        return normalized.substring(0, 180) + "...";
    }

    private String extractChoiceText(JSONObject response) throws IOException {
        JSONArray choices = response.optJSONArray("choices");
        if (choices == null || choices.length() == 0) {
            throw new IOException("模型未返回文本");
        }
        JSONObject message = choices.optJSONObject(0).optJSONObject("message");
        if (message == null) {
            throw new IOException("模型返回格式异常");
        }
        Object content = message.opt("content");
        if (content instanceof String) {
            return (String) content;
        }
        if (content instanceof JSONArray) {
            JSONArray items = (JSONArray) content;
            StringBuilder text = new StringBuilder();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item != null) {
                    String part = item.optString("text", "");
                    if (!part.isEmpty()) {
                        text.append(part);
                    }
                }
            }
            return text.toString();
        }
        return content == null ? "" : content.toString();
    }

    private String extractDelta(String data) {
        try {
            JSONObject parsed = new JSONObject(data);
            JSONArray choices = parsed.optJSONArray("choices");
            if (choices == null || choices.length() == 0) {
                return "";
            }
            JSONObject delta = choices.optJSONObject(0).optJSONObject("delta");
            if (delta == null) {
                return "";
            }
            Object content = delta.opt("content");
            return content instanceof String ? (String) content : "";
        } catch (JSONException ignored) {
            return "";
        }
    }

    private byte[] parseTtsStream(InputStream inputStream) throws IOException, JSONException {
        ByteArrayOutputStream audio = new ByteArrayOutputStream();
        String apiError = null;

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                inputStream,
                StandardCharsets.UTF_8
        ))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (!trimmed.startsWith("data:")) {
                    continue;
                }
                String data = trimmed.substring(5).trim();
                if (data.isEmpty() || "[DONE]".equals(data)) {
                    continue;
                }
                JSONObject parsed = new JSONObject(data);
                String message = parsed.optString("message", "");
                if (!message.isEmpty()) {
                    apiError = message;
                }
                byte[] chunk = audioBytesFromJson(parsed);
                if (chunk != null) {
                    audio.write(chunk);
                }
            }
        }

        if (audio.size() > 0) {
            return audio.toByteArray();
        }
        throw new IOException(apiError == null ? "TTS 未返回音频" : apiError);
    }

    private byte[] parseTtsJson(JSONObject parsed) throws IOException {
        byte[] inlineAudio = audioBytesFromJson(parsed);
        if (inlineAudio != null) {
            return inlineAudio;
        }

        JSONObject output = parsed.optJSONObject("output");
        JSONObject audio = output == null ? null : output.optJSONObject("audio");
        String audioUrl = audio == null ? "" : audio.optString("url", "");
        if (!audioUrl.isEmpty()) {
            return downloadAudio(audioUrl);
        }

        String message = parsed.optString("message", "");
        throw new IOException(message.isEmpty() ? "TTS 未返回音频" : message);
    }

    private byte[] audioBytesFromJson(JSONObject parsed) {
        JSONObject output = parsed.optJSONObject("output");
        JSONObject audio = output == null ? null : output.optJSONObject("audio");
        String data = audio == null ? "" : audio.optString("data", "");
        if (data.isEmpty()) {
            return null;
        }
        return Base64.decode(data, Base64.DEFAULT);
    }

    private byte[] downloadAudio(String audioUrl) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(audioUrl).openConnection();
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(60_000);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("音频下载失败 (" + status + ")");
            }
            return readAll(connection.getInputStream());
        } finally {
            connection.disconnect();
        }
    }

    private JSONObject postJson(String endpoint, JSONObject body, boolean stream)
            throws IOException, JSONException {
        HttpURLConnection connection = openPostConnection(endpoint, stream);
        try {
            writeJson(connection, body);
            int status = connection.getResponseCode();
            String text = status >= 200 && status < 300
                    ? readText(connection.getInputStream())
                    : readError(connection);
            if (status < 200 || status >= 300) {
                throw new IOException("请求失败 (" + status + "): " + text);
            }
            return new JSONObject(text);
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection openPostConnection(String endpoint, boolean stream) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(stream ? 120_000 : 60_000);
        connection.setDoOutput(true);
        connection.setUseCaches(false);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + apiKey);
        return connection;
    }

    private void writeJson(HttpURLConnection connection, JSONObject body) throws IOException {
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream outputStream = connection.getOutputStream()) {
            outputStream.write(payload);
        }
    }

    private String readError(HttpURLConnection connection) throws IOException {
        InputStream stream = connection.getErrorStream();
        return stream == null ? "" : readText(stream);
    }

    private String readText(InputStream inputStream) throws IOException {
        return new String(readAll(inputStream), StandardCharsets.UTF_8);
    }

    private static byte[] readAll(InputStream inputStream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = inputStream.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    private void ensureApiKey() throws IOException {
        if (!hasApiKey()) {
            throw new IOException("请先在 local.properties 配置 DASHSCOPE_API_KEY");
        }
    }
}
