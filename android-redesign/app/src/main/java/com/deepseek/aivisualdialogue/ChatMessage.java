package com.deepseek.aivisualdialogue;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class ChatMessage {
    enum Role {
        USER,
        ASSISTANT
    }

    final String id;
    final Role role;
    final String imageDataUrl;
    final String visualDescription;
    final long timestamp;
    final List<byte[]> audioChunks = new ArrayList<>();
    volatile String text;
    byte[] audioBytes;

    ChatMessage(Role role, String text, String imageDataUrl) {
        this(role, text, imageDataUrl, null);
    }

    ChatMessage(Role role, String text, String imageDataUrl, String visualDescription) {
        this.id = UUID.randomUUID().toString();
        this.role = role;
        this.text = text;
        this.imageDataUrl = imageDataUrl;
        this.visualDescription = visualDescription == null ? "" : visualDescription.trim();
        this.timestamp = System.currentTimeMillis();
    }
}
