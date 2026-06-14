package com.deepseek.aivisualdialogue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class WavEncoder {
    private WavEncoder() {
    }

    static byte[] pcm16MonoToWav(byte[] pcm16Le, int sampleRate) {
        int dataSize = pcm16Le.length;
        int channels = 1;
        int bitsPerSample = 16;
        int byteRate = sampleRate * channels * bitsPerSample / 8;
        int blockAlign = channels * bitsPerSample / 8;

        ByteArrayOutputStream out = new ByteArrayOutputStream(44 + dataSize);
        try {
            writeAscii(out, "RIFF");
            writeIntLe(out, 36 + dataSize);
            writeAscii(out, "WAVE");
            writeAscii(out, "fmt ");
            writeIntLe(out, 16);
            writeShortLe(out, 1);
            writeShortLe(out, channels);
            writeIntLe(out, sampleRate);
            writeIntLe(out, byteRate);
            writeShortLe(out, blockAlign);
            writeShortLe(out, bitsPerSample);
            writeAscii(out, "data");
            writeIntLe(out, dataSize);
            out.write(pcm16Le);
        } catch (IOException impossible) {
            throw new IllegalStateException(impossible);
        }
        return out.toByteArray();
    }

    private static void writeAscii(ByteArrayOutputStream out, String value) throws IOException {
        out.write(value.getBytes(StandardCharsets.US_ASCII));
    }

    private static void writeIntLe(ByteArrayOutputStream out, int value) {
        out.write(value & 0xff);
        out.write((value >> 8) & 0xff);
        out.write((value >> 16) & 0xff);
        out.write((value >> 24) & 0xff);
    }

    private static void writeShortLe(ByteArrayOutputStream out, int value) {
        out.write(value & 0xff);
        out.write((value >> 8) & 0xff);
    }
}
