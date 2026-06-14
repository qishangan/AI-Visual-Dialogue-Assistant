package com.deepseek.aivisualdialogue;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Surface;
import android.view.TextureView;

import java.util.Collections;

final class CameraPreviewController {
    interface Listener {
        void onCameraError(String message);
    }

    private final Activity activity;
    private final Listener listener;
    private TextureView textureView;
    private HandlerThread backgroundThread;
    private Handler backgroundHandler;
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private Surface previewSurface;
    private boolean openRequested;
    private boolean opening;

    CameraPreviewController(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    void attach(TextureView textureView) {
        this.textureView = textureView;
        textureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override
            public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
                if (openRequested) {
                    open();
                }
            }

            @Override
            public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
                if (captureSession == null && cameraDevice != null) {
                    startPreview();
                }
            }

            @Override
            public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
                close();
                return true;
            }

            @Override
            public void onSurfaceTextureUpdated(SurfaceTexture surface) {
            }
        });
        if (textureView.isAvailable()) {
            open();
        }
    }

    void open() {
        openRequested = true;
        if (textureView == null || !textureView.isAvailable()) {
            return;
        }
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (cameraDevice != null) {
            if (captureSession == null) {
                startPreview();
            }
            return;
        }
        if (opening) {
            return;
        }

        startBackgroundThread();

        CameraManager manager = (CameraManager) activity.getSystemService(Context.CAMERA_SERVICE);
        try {
            String cameraId = findBackCamera(manager);
            opening = true;
            manager.openCamera(cameraId, stateCallback, backgroundHandler);
        } catch (SecurityException error) {
            opening = false;
            listener.onCameraError("没有相机权限");
        } catch (CameraAccessException | IllegalArgumentException error) {
            opening = false;
            listener.onCameraError("相机启动失败");
        }
    }

    void close() {
        openRequested = false;
        opening = false;
        if (captureSession != null) {
            captureSession.close();
            captureSession = null;
        }
        if (cameraDevice != null) {
            cameraDevice.close();
            cameraDevice = null;
        }
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
        stopBackgroundThread();
    }

    Bitmap captureBitmap() {
        if (textureView == null || !textureView.isAvailable()) {
            return null;
        }
        return textureView.getBitmap();
    }

    private String findBackCamera(CameraManager manager) throws CameraAccessException {
        String fallback = null;
        for (String id : manager.getCameraIdList()) {
            if (fallback == null) {
                fallback = id;
            }
            CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
            Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                return id;
            }
        }
        if (fallback == null) {
            throw new IllegalArgumentException("No camera found");
        }
        return fallback;
    }

    private final CameraDevice.StateCallback stateCallback = new CameraDevice.StateCallback() {
        @Override
        public void onOpened(CameraDevice camera) {
            opening = false;
            if (!openRequested) {
                camera.close();
                return;
            }
            cameraDevice = camera;
            startPreview();
        }

        @Override
        public void onDisconnected(CameraDevice camera) {
            opening = false;
            camera.close();
            cameraDevice = null;
        }

        @Override
        public void onError(CameraDevice camera, int error) {
            opening = false;
            camera.close();
            cameraDevice = null;
            listener.onCameraError("相机预览异常");
        }
    };

    private void startPreview() {
        if (cameraDevice == null || textureView == null || !textureView.isAvailable()) {
            return;
        }

        SurfaceTexture surfaceTexture = textureView.getSurfaceTexture();
        if (surfaceTexture == null) {
            return;
        }
        if (captureSession != null) {
            captureSession.close();
            captureSession = null;
        }
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
        surfaceTexture.setDefaultBufferSize(1280, 720);
        previewSurface = new Surface(surfaceTexture);

        try {
            CaptureRequest.Builder requestBuilder =
                    cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            requestBuilder.addTarget(previewSurface);
            requestBuilder.set(
                    CaptureRequest.CONTROL_AF_MODE,
                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
            );

            cameraDevice.createCaptureSession(
                    Collections.singletonList(previewSurface),
                    new CameraCaptureSession.StateCallback() {
                        @Override
                        public void onConfigured(CameraCaptureSession session) {
                            if (!openRequested || cameraDevice == null || previewSurface == null) {
                                session.close();
                                return;
                            }
                            captureSession = session;
                            try {
                                captureSession.setRepeatingRequest(
                                        requestBuilder.build(),
                                        null,
                                        backgroundHandler
                                );
                            } catch (CameraAccessException error) {
                                listener.onCameraError("相机预览失败");
                            }
                        }

                        @Override
                        public void onConfigureFailed(CameraCaptureSession session) {
                            session.close();
                            listener.onCameraError("相机预览失败");
                        }
                    },
                    backgroundHandler
            );
        } catch (CameraAccessException error) {
            listener.onCameraError("相机预览失败");
        }
    }

    private void startBackgroundThread() {
        if (backgroundThread != null) {
            return;
        }
        backgroundThread = new HandlerThread("camera-preview");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());
    }

    private void stopBackgroundThread() {
        if (backgroundThread == null) {
            return;
        }
        backgroundThread.quitSafely();
        try {
            backgroundThread.join();
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        backgroundThread = null;
        backgroundHandler = null;
    }
}
