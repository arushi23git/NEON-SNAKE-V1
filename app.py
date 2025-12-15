# app.py
"""
Flask + Flask-SocketIO server using threading mode (no eventlet/gevent),
compatible with Python 3.12.

Each connected client gets its own Game instance and a background
thread that advances the game loop and emits states to that client.
"""

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import threading
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
# Use threading async mode so we don't require eventlet/gevent.
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Game settings
CELL_SIZE = 20
GRID_W = 30
GRID_H = 20
INITIAL_SPEED = 0.12  # seconds per tick

# Per-client game storage
games = {}         # sid -> Game
games_locks = {}   # sid -> threading.Lock()
threads = {}       # sid -> threading.Thread


class Game:
    def __init__(self, w=GRID_W, h=GRID_H):
        self.w = w
        self.h = h
        self.reset()

    def reset(self):
        midx = self.w // 2
        midy = self.h // 2
        self.snake = [(midx, midy), (midx-1, midy), (midx-2, midy)]
        self.direction = (1, 0)  # moving right
        self.spawn_food()
        self.score = 0
        self.alive = True
        self.speed = INITIAL_SPEED
        self.pending_dir = None  # buffer a single direction change per tick

    def spawn_food(self):
        empty = {(x, y) for x in range(self.w) for y in range(self.h)} - set(self.snake)
        self.food = random.choice(list(empty)) if empty else None

    def change_direction(self, dx, dy):
        # prevent reversing directly
        if (dx, dy) == (-self.direction[0], -self.direction[1]):
            return
        self.pending_dir = (dx, dy)

    def step(self):
        if not self.alive:
            return

        if self.pending_dir:
            self.direction = self.pending_dir
            self.pending_dir = None

        head = self.snake[0]
        new_head = ((head[0] + self.direction[0]) % self.w,
                    (head[1] + self.direction[1]) % self.h)

        # collision with self
        if new_head in self.snake:
            self.alive = False
            return

        # move snake
        self.snake.insert(0, new_head)
        if self.food and new_head == self.food:
            self.score += 1
            # speed up slightly but cap
            self.speed = max(0.04, self.speed * 0.98)
            self.spawn_food()
        else:
            self.snake.pop()

    def get_state(self):
        return {
            'w': self.w,
            'h': self.h,
            'snake': self.snake,
            'food': self.food,
            'score': self.score,
            'alive': self.alive,
            'speed': self.speed
        }


def game_loop(sid):
    """Background loop for a single client identified by sid.
    Runs in a dedicated thread and emits 'state' events to the client's room.
    """
    # keep running while the client game exists
    while True:
        lock = games_locks.get(sid)
        if lock is None:
            break

        with lock:
            game = games.get(sid)
            if game is None:
                break
            if not game.alive:
                socketio.emit('state', game.get_state(), room=sid)
                break
            game.step()
            state = game.get_state()

        # emit the state outside the lock
        socketio.emit('state', state, room=sid)
        # sleep according to game's speed
        time.sleep(state['speed'])

    # cleanup after loop ends
    with threading.Lock():
        games.pop(sid, None)
        games_locks.pop(sid, None)
        threads.pop(sid, None)


@app.route('/')
def index():
    return render_template('index.html')


@socketio.on('connect')
def on_connect():
    sid = request.sid
    print(f'Client connected: {sid}')

    # create a new game for this client
    with threading.Lock():
        lock = threading.Lock()
        games_locks[sid] = lock
        games[sid] = Game()
    join_room(sid)

    # start a background thread for the game loop
    t = threading.Thread(target=game_loop, args=(sid,), daemon=True)
    threads[sid] = t
    t.start()

    # send initial state
    emit('state', games[sid].get_state())


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    print(f'Client disconnected: {sid}')
    # remove game; thread will see the missing lock/game and finish
    with threading.Lock():
        games.pop(sid, None)
        if sid in games_locks:
            games_locks.pop(sid, None)
        if sid in threads:
            threads.pop(sid, None)
    leave_room(sid)


@socketio.on('change_direction')
def on_change_direction(data):
    sid = request.sid
    dx = int(data.get('dx', 0))
    dy = int(data.get('dy', 0))
    lock = games_locks.get(sid)
    if lock is None:
        return
    with lock:
        game = games.get(sid)
        if game:
            game.change_direction(dx, dy)


@socketio.on('restart')
def on_restart():
    sid = request.sid
    lock = games_locks.get(sid)
    if lock is None:
        return
    with lock:
        game = games.get(sid)
        if game:
            game.reset()
            emit('state', game.get_state(), room=sid)
            # If the thread already ended, spawn a new thread (safe check)
            if sid not in threads or not threads[sid].is_alive():
                t = threading.Thread(target=game_loop, args=(sid,), daemon=True)
                threads[sid] = t
                t.start()


if __name__ == '__main__':
    print("Starting server on http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)

