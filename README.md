# Driver Drowsiness

A driver drowsiness detection system that monitors facial landmarks and alerts the driver when signs of fatigue are detected.

## Features

- Real-time face detection using camera input
- Eye aspect ratio (EAR) for blink and closure detection
- Desktop audio alert for drowsiness events
- Web dashboard with alert status and process controls
- Built with OpenCV, MediaPipe, and Python

## Requirements

- Python 3.8 or newer
- Windows OS (uses `winsound` for audio alerts)
- Webcam or camera device

## Python Dependencies

- `opencv-python`
- `mediapipe`
- `numpy`

## Installation

1. Clone or download the project to your machine.
2. Create and activate a Python virtual environment:

```bash
python -m venv venv
venv\Scripts\activate
```

3. Install the required packages:

```bash
pip install -r requirements.txt
```

## Running the detection script

To start the driver drowsiness detection directly:

```bash
python drowsiness.py
```

- The camera feed will open in a new window.
- Press `q` to quit.
- The system will update `web/alert-status.json` when an alert is triggered.

## Running the web dashboard

Start the web server from the project root:

```bash
python web/server.py
```

Then open the dashboard in your browser:

```
http://localhost:8000
```

The web dashboard can show alert status and support starting/stopping the detection process.

## Project Files

- `drowsiness.py` - main detection script using MediaPipe face landmarks
- `face_detect.py` - helper face detection example with OpenCV
- `test_camera.py` - sample camera test script
- `web/server.py` - local HTTP server for dashboard and API
- `web/app.js` - frontend logic for status updates
- `web/index.html` - dashboard HTML interface
- `web/styles.css` - dashboard CSS styling
- `face_landmarker.task` - MediaPipe model asset
- `haarcascade_frontalface_default.xml` - OpenCV Haar cascade face detector

## Notes

- This project is designed for Windows because of the built-in beep support via `winsound`.
- If you want to run on another OS, remove or replace `winsound` audio logic.

## Author

- Abhinaypal
