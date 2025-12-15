🐍 Neon Snake – Web App Game (Python + Flask + WebSockets)

A responsive, fast, and modern browser-based Snake game built using:

Python 3.12

Flask

Flask-SocketIO (real-time engine)

HTML5 Canvas

CSS3 (Neon & Light Themes)

Vanilla JavaScript (game client + renderer)

The project runs entirely as a web application — the game logic runs on Python, while the client renders the gameplay smoothly with Canvas, including particles, animations, responsive controls, and a modern UI.

✨ Features 🎮 Gameplay

Real-time snake movement using keyboard, buttons, or swipe

Adaptive responsive gameplay grid

Food pickup animations + neon glow

Smooth Snake movement & pulsing food effects

Particle background for a premium feel

🧠 Game Logic (Server-Side)

Python-based logic ensures accuracy & fairness

Real-time sync via WebSockets every frame

🏆 Leaderboard

Stored in browser using localStorage

Stores top 10 scores

Players enter their name after each game

🎨 Themes

Fully working Theme Toggle

Switch between:

🌑 Dark (Neon mode)

☀️ Light mode

Smooth transitions & persistent selection

📱 Controls

Arrow keys + WASD support

On-screen arrow buttons

Mobile swipe detection

Pause / Restart clearly visible

📐 Responsiveness

Works perfectly on:

Desktop (Chrome, Edge, Firefox)

Mobile browsers

Tablets

🧼 Clean UI

Modern neon look

Smooth motion and ripple effects

Organized control panel

🖼️ Screenshots

(Replace with your actual image links)

Home Screen Gameplay Leaderboard

🚀 Project Structure Snake_game_webapp/ │ ├── app.py # Flask backend + game engine ├── requirements.txt # Dependencies │ ├── static/ │ ├── style.css # Full UI + themes + animations │ └── game.js # Client renderer + input + theme toggle │ └── templates/ └── index.html # Main HTML page

🛠️ Tech Stack Backend

Python 3.12

Flask

Flask-SocketIO (WebSockets)

Event loop: Python-native (no eventlet required for 3.12)

Frontend

HTML5 Canvas API

CSS3 (neon + glassmorphism styling)

Vanilla JavaScript (client rendering engine)

📦 Installation & Setup 1️⃣ Clone the Repository git clone https://github.com//.git cd

2️⃣ Create Virtual Environment python -m venv .venv

Activate it:

Windows

.venv\Scripts\activate

Mac/Linux

source .venv/bin/activate

3️⃣ Install Requirements pip install -r requirements.txt

4️⃣ Run the App python app.py

5️⃣ Open in Browser http://localhost:5000

🧩 Gameplay Controls Action Control Move Up ↑ or W Move Down ↓ or S Move Left ← or A Move Right → or D Restart Game Restart button Pause Pause button Theme Toggle Theme button or press T Swipe Controls Available on mobile 🧪 Tested On

Windows 10 / 11

Android Chrome

iOS Safari

Chrome, Edge, Firefox (Latest)

🔧 Troubleshooting Game does not restart after one round?

This has been fixed in the latest update using:

multi-event restart emit

full state reset

fallback reload for dropped socket connections

Theme button not responding?

Now replaced with a robust universal theme toggle system with:

auto-discovery of theme button

fallback button injection

theme toast notifications

📜 License

This project is licensed under the MIT License.

🙌 Author

Abhishuman Roy & Arushi Sengupta • Developer

⭐ Show Support

If you like this project, please ⭐ the repo and share it! Every star motivates more improvements.
