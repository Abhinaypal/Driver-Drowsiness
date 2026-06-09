import cv2
import mediapipe as mp
import numpy as np
import time
import winsound
import json
import os
import threading
from pathlib import Path

MODEL_PATH = str(Path(__file__).with_name("face_landmarker.task"))

BaseOptions = mp.tasks.BaseOptions
FaceLandmarker = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

status_file = os.path.join(os.path.dirname(__file__), "web", "alert-status.json")


def update_alert_status(is_alert):
    try:
        os.makedirs(os.path.dirname(status_file), exist_ok=True)
        with open(status_file, "w", encoding="utf-8") as f:
            json.dump({"alert": bool(is_alert), "timestamp": time.time()}, f)
    except Exception:
        pass


def play_beep():
    """Run winsound.Beep in a daemon thread so it never blocks the main loop."""
    threading.Thread(target=lambda: winsound.Beep(1000, 500), daemon=True).start()


update_alert_status(False)

# Eye landmark indices (MediaPipe 468-point mesh)
LEFT_EYE  = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]


def eye_aspect_ratio(eye_points, landmarks, w, h):
    """Calculate Eye Aspect Ratio (EAR) for blink/closure detection."""
    pts = [(int(landmarks[p].x * w), int(landmarks[p].y * h)) for p in eye_points]
    A = np.linalg.norm(np.array(pts[1]) - np.array(pts[5]))
    B = np.linalg.norm(np.array(pts[2]) - np.array(pts[4]))
    C = np.linalg.norm(np.array(pts[0]) - np.array(pts[3]))
    return (A + B) / (2.0 * C)


# ── Tuning constants ──────────────────────────────────────────────────────────
EAR_THRESHOLD = 0.25   # below this value → eye is considered closed
CLOSED_TIME   = 2.0    # seconds eyes must stay closed before alert triggers
BEEP_INTERVAL = 1.0    # seconds between consecutive alert beeps
# ─────────────────────────────────────────────────────────────────────────────

eyes_closed_since = None
current_alert     = False
last_beep_time    = 0.0

# Start camera
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    raise RuntimeError("Could not open camera 0")

options = FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=VisionRunningMode.VIDEO,
    num_faces=1,
)

with FaceLandmarker.create_from_options(options) as landmarker:
    app_started_at = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        h, w = frame.shape[:2]

        # Convert to RGB for MediaPipe
        rgb      = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms    = int((time.time() - app_started_at) * 1000)
        result   = landmarker.detect_for_video(mp_image, ts_ms)

        if result.face_landmarks:
            for landmarks in result.face_landmarks:
                left_ear  = eye_aspect_ratio(LEFT_EYE,  landmarks, w, h)
                right_ear = eye_aspect_ratio(RIGHT_EYE, landmarks, w, h)
                ear = (left_ear + right_ear) / 2.0

                if ear < EAR_THRESHOLD:
                    # Eyes closed — start / continue timing
                    if eyes_closed_since is None:
                        eyes_closed_since = time.time()
                    elif time.time() - eyes_closed_since > CLOSED_TIME:
                        # Trigger alert
                        if not current_alert:
                            current_alert = True
                            update_alert_status(True)

                        cv2.putText(frame, "DROWSY ALERT!", (50, 50),
                                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)

                        # Beep at most once per BEEP_INTERVAL — runs in background
                        # thread so it never blocks the camera loop
                        now = time.time()
                        if now - last_beep_time >= BEEP_INTERVAL:
                            last_beep_time = now
                            play_beep()
                else:
                    # Eyes open — reset
                    eyes_closed_since = None
                    if current_alert:
                        current_alert = False
                        update_alert_status(False)

        # Show live feed
        cv2.imshow("Drowsiness Detection", frame)

        # Press 'q' to quit
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

cap.release()
cv2.destroyAllWindows()
update_alert_status(False)
