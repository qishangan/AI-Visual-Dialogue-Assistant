package com.deepseek.aivisualdialogue;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

final class SelectionOverlayView extends View {
    private final Paint maskPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint chipPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float minSelectionPx;

    private RectF selection;
    private float startX;
    private float startY;
    private boolean dragging;
    private boolean locked;

    SelectionOverlayView(Context context) {
        super(context);
        minSelectionPx = 28f * getResources().getDisplayMetrics().density;
        maskPaint.setColor(Color.argb(82, 17, 45, 64));
        borderPaint.setColor(Color.rgb(28, 124, 125));
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(2.4f * getResources().getDisplayMetrics().density);
        chipPaint.setColor(Color.argb(190, 255, 255, 255));
        textPaint.setColor(Color.rgb(30, 44, 54));
        textPaint.setTextSize(12f * getResources().getDisplayMetrics().scaledDensity);
        setWillNotDraw(false);
    }

    void setLocked(boolean locked) {
        this.locked = locked;
    }

    RectF getSelectionRect() {
        return selection == null ? null : new RectF(selection);
    }

    void clearSelection() {
        selection = null;
        invalidate();
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (locked) {
            return false;
        }

        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                dragging = true;
                startX = clamp(event.getX(), 0, getWidth());
                startY = clamp(event.getY(), 0, getHeight());
                selection = new RectF(startX, startY, startX, startY);
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!dragging) {
                    return false;
                }
                updateSelection(event.getX(), event.getY());
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (!dragging) {
                    return false;
                }
                updateSelection(event.getX(), event.getY());
                dragging = false;
                if (selection != null &&
                        (selection.width() < minSelectionPx || selection.height() < minSelectionPx)) {
                    selection = null;
                }
                invalidate();
                return true;
            default:
                return false;
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (selection == null) {
            drawHint(canvas);
            return;
        }

        canvas.drawRect(0, 0, getWidth(), selection.top, maskPaint);
        canvas.drawRect(0, selection.bottom, getWidth(), getHeight(), maskPaint);
        canvas.drawRect(0, selection.top, selection.left, selection.bottom, maskPaint);
        canvas.drawRect(selection.right, selection.top, getWidth(), selection.bottom, maskPaint);
        canvas.drawRoundRect(selection, 8f, 8f, borderPaint);
    }

    private void updateSelection(float x, float y) {
        float endX = clamp(x, 0, getWidth());
        float endY = clamp(y, 0, getHeight());
        selection = new RectF(
                Math.min(startX, endX),
                Math.min(startY, endY),
                Math.max(startX, endX),
                Math.max(startY, endY)
        );
        invalidate();
    }

    private void drawHint(Canvas canvas) {
        String label = "框选题目区域";
        float density = getResources().getDisplayMetrics().density;
        float paddingX = 10f * density;
        float paddingY = 6f * density;
        float textWidth = textPaint.measureText(label);
        RectF chip = new RectF(
                getWidth() - textWidth - paddingX * 2f - 14f * density,
                14f * density,
                getWidth() - 14f * density,
                14f * density + textPaint.getTextSize() + paddingY * 2f
        );
        canvas.drawRoundRect(chip, 18f * density, 18f * density, chipPaint);
        canvas.drawText(label, chip.left + paddingX, chip.bottom - paddingY - 2f * density, textPaint);
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }
}
