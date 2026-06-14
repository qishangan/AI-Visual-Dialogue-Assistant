package com.deepseek.aivisualdialogue;

import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

final class DeepSeekClient {
    interface StreamCallback {
        void onDelta(String delta);
    }

    private static final String CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
    private static final String MODEL = "deepseek-v4-flash";
    private static final int MAX_HISTORY_MESSAGES = 12;
    private static final int CONTEXT_EXCERPT_MESSAGES = 6;

    private static final String SYSTEM_PROMPT =
            "你是一个高水平的中文学习引导助手。你的目标是带着学生自己想明白题目，而不是直接替他解完。\n" +
            "你会收到最近对话历史；如果本轮摄像头截图成功，还会收到另一模型生成的图片文字转写。\n" +
            "图片转写只是辅助事实，不是最终答案；如果和当前问题无关，就忽略它，优先根据文字和上下文回答。\n" +
            "只要提供了图片转写，就把它当作图片内容的文字输入使用，不要回答“我看不到图片”或“无法查看图片”。\n" +
            "如果学生问“怎么来的”“为什么”“这一步呢”“这个呢”等短追问，必须优先回看上一轮用户问题和助手回复，解释刚才提到的结果、步骤或概念。\n" +
            "解题规则：不要一上来直接给最终答案，也不要一次性写完整解题过程。先判断学生卡在哪里，然后每次只给一个小提示、一个观察角度或一个下一步问题。\n" +
            "只有当学生明确说“不懂”“不会”“直接告诉我”“给答案”并持续追问时，才逐步给更具体的步骤；即便如此也尽量先解释思路，再给结果。\n" +
            "涉及数学时尽量用大白话解释，不要用 LaTeX、Markdown 公式块、特殊标签或复杂符号。能说“先看一共有几份、每份是多少”就不要写公式。\n" +
            "如果必须表达算式，用普通文字写短算式，例如“二乘三等于六”“把总数除以份数”，不要堆符号。\n" +
            "回答要简洁、准确、连贯，默认不超过 3 句，结尾优先抛一个能引导学生继续思考的小问题。\n" +
            "不要输出推理过程全文，不要把自己说成视觉模型。";

    private final String apiKey;

    DeepSeekClient(String apiKey) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
    }

    boolean hasApiKey() {
        return !TextUtils.isEmpty(apiKey);
    }

    String streamAnswer(
            List<ChatMessage> history,
            String userText,
            String imageDescription,
            StreamCallback callback
    ) throws IOException, JSONException {
        ensureApiKey();

        JSONObject body = new JSONObject()
                .put("model", MODEL)
                .put("messages", buildMessages(history, userText, imageDescription))
                .put("stream", true)
                .put("thinking", new JSONObject().put("type", "disabled"))
                .put("temperature", 0.2);

        HttpURLConnection connection = openPostConnection(CHAT_COMPLETIONS_URL, true);
        try {
            writeJson(connection, body);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("DeepSeek 请求失败 (" + status + "): " + readError(connection));
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

    private JSONArray buildMessages(List<ChatMessage> history, String userText, String imageDescription)
            throws JSONException {
        JSONArray messages = new JSONArray()
                .put(new JSONObject()
                        .put("role", "system")
                        .put("content", SYSTEM_PROMPT));

        int start = Math.max(0, history.size() - MAX_HISTORY_MESSAGES);
        for (int i = start; i < history.size(); i++) {
            ChatMessage message = history.get(i);
            String content = buildHistoryContent(message);
            if (content.isEmpty()) {
                continue;
            }
            messages.put(new JSONObject()
                    .put("role", message.role == ChatMessage.Role.USER ? "user" : "assistant")
                    .put("content", content));
        }

        String contextExcerpt = buildContextExcerpt(history);
        if (!contextExcerpt.isEmpty()) {
            messages.put(new JSONObject()
                    .put("role", "system")
                    .put("content", "最近对话摘录如下。当前问题如果是追问、代词或省略表达，必须优先依据这段上下文回答，不要把它当成全新的独立问题。\n" + contextExcerpt));
        }

        StringBuilder currentTurn = new StringBuilder();
        currentTurn.append("学生本轮问题：").append(userText).append('\n');
        if (!TextUtils.isEmpty(imageDescription)) {
            currentTurn.append('\n')
                    .append("本轮图片转写（视觉模型已读取图片，只是辅助事实）：")
                    .append('\n')
                    .append(imageDescription.trim())
                    .append('\n')
                    .append('\n')
                    .append("如果这段图片转写与问题有关，请直接依据它回答，不要说看不到图片；如果无关，请忽略它，直接根据文字和上下文回答。");
        }

        messages.put(new JSONObject()
                .put("role", "user")
                .put("content", currentTurn.toString()));
        return messages;
    }

    private String buildHistoryContent(ChatMessage message) {
        if (message.text == null || message.text.trim().isEmpty()) {
            return "";
        }
        if (message.role != ChatMessage.Role.USER || TextUtils.isEmpty(message.visualDescription)) {
            return message.text;
        }
        return message.text.trim()
                + "\n\n历史图片转写（来自该轮自动截图）：\n"
                + trimVisualDescription(message.visualDescription);
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
                    .append(trimForContext(message.text));
            if (message.role == ChatMessage.Role.USER && !TextUtils.isEmpty(message.visualDescription)) {
                excerpt.append("；图片转写：").append(trimForContext(message.visualDescription));
            }
            excerpt.append('\n');
        }
        return excerpt.toString().trim();
    }

    private String trimVisualDescription(String text) {
        String normalized = text.replace('\n', ' ').trim();
        if (normalized.length() <= 700) {
            return normalized;
        }
        return normalized.substring(0, 700) + "...";
    }

    private String trimForContext(String text) {
        String normalized = text.replace('\n', ' ').trim();
        if (normalized.length() <= 180) {
            return normalized;
        }
        return normalized.substring(0, 180) + "...";
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
        byte[] buffer = new byte[8192];
        StringBuilder text = new StringBuilder();
        int read;
        while ((read = inputStream.read(buffer)) != -1) {
            text.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
        }
        return text.toString();
    }

    private void ensureApiKey() throws IOException {
        if (!hasApiKey()) {
            throw new IOException("请先在 local.properties 配置 DEEPSEEK_API_KEY");
        }
    }
}
