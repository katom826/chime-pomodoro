import Style from "./index.module.css";
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent,
  SyntheticEvent,
} from "react";

const CLOCK_CENTER = 50;
const CLOCK_RADIUS = 48;
const WORK_TIME_MIN = 1;
const WORK_TIME_MAX = 29;
const HALF_HOUR_SECONDS = 30 * 60;
const CLOCK_TICK_INTERVAL_MS = 1000;
const DIALOG_CLOSE_DURATION_MS = 220;
const WORK_TIME_STORAGE_KEY = "pomodoro-work-time";
const INITIAL_DIALOG_SHOWN_STORAGE_KEY = "pomodoro-initial-dialog-shown";
const SOUND_ENABLED_STORAGE_KEY = "pomodoro-sound-enabled";
const RANGE_MARKS = [1, 5, 10, 15, 20, 25, 29] as const;

const parseStoredWorkTime = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  if (
    Number.isInteger(parsed) &&
    parsed >= WORK_TIME_MIN &&
    parsed <= WORK_TIME_MAX
  ) {
    return parsed;
  }
  return null;
};

const parseStoredBool = (value: string | null, fallback: boolean) => {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
};

const formatMmSs = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;

const polarToCartesian = (angleDeg: number) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CLOCK_CENTER + CLOCK_RADIUS * Math.cos(rad),
    y: CLOCK_CENTER + CLOCK_RADIUS * Math.sin(rad),
  };
};

const createSectorPath = (startDeg: number, endDeg: number) => {
  const start = polarToCartesian(startDeg);
  const end = polarToCartesian(endDeg);
  const largeArcFlag = endDeg - startDeg > 180 ? 1 : 0;
  return `
    M ${CLOCK_CENTER} ${CLOCK_CENTER}
    L ${start.x} ${start.y}
    A ${CLOCK_RADIUS} ${CLOCK_RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}
    Z
  `;
};

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  const [workTime, setWorkTime] = useState(25);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [shouldAutoOpenDialog, setShouldAutoOpenDialog] = useState(false);
  const [isDialogShown, setIsDialogShown] = useState(false);
  const [isInitialDialogOpen, setIsInitialDialogOpen] = useState(false);
  const [isDialogClosing, setIsDialogClosing] = useState(false);
  const menuDialogRef = useRef<HTMLDialogElement>(null);
  const menuCloseBtnRef = useRef<HTMLButtonElement>(null);
  const dialogCloseAnimationRef = useRef<Animation | null>(null);
  const pointerDownStartedInsideDialogRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const prevIsWorkTimeRef = useRef<boolean | null>(null);

  useEffect(() => {
    const savedWorkTime = parseStoredWorkTime(
      window.localStorage.getItem(WORK_TIME_STORAGE_KEY),
    );
    if (savedWorkTime !== null) {
      setWorkTime(savedWorkTime);
    }
    setSoundEnabled(
      parseStoredBool(
        window.localStorage.getItem(SOUND_ENABLED_STORAGE_KEY),
        false,
      ),
    );

    const hasShownInitialDialog = window.localStorage.getItem(
      INITIAL_DIALOG_SHOWN_STORAGE_KEY,
    );
    if (!hasShownInitialDialog) {
      setShouldAutoOpenDialog(true);
      setIsInitialDialogOpen(true);
      window.localStorage.setItem(INITIAL_DIALOG_SHOWN_STORAGE_KEY, "1");
    }

    const updateCurrentTime = () => {
      setNow(new Date());
    };

    updateCurrentTime();

    const intervalId = setInterval(updateCurrentTime, CLOCK_TICK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WORK_TIME_STORAGE_KEY, String(workTime));
  }, [workTime]);

  useEffect(() => {
    window.localStorage.setItem(
      SOUND_ENABLED_STORAGE_KEY,
      soundEnabled ? "1" : "0",
    );
  }, [soundEnabled]);

  useEffect(() => {
    if (!now || !shouldAutoOpenDialog || !menuDialogRef.current) return;

    if (!menuDialogRef.current.open) {
      setIsDialogShown(true);
      menuDialogRef.current.showModal();
      menuCloseBtnRef.current?.focus();
    }
    setShouldAutoOpenDialog(false);
  }, [now, shouldAutoOpenDialog]);

  useEffect(() => {
    return () => {
      dialogCloseAnimationRef.current?.cancel();
      dialogCloseAnimationRef.current = null;
    };
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();
    audioContextRef.current = context;
    return context;
  }, []);

  useEffect(() => {
    const unlockAudio = () => {
      const context = ensureAudioContext();
      if (context && context.state === "suspended") {
        void context.resume();
      }
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [ensureAudioContext]);

  const playSwitchChime = useCallback(async () => {
    const context = ensureAudioContext();
    if (!context) return;
    if (context.state !== "running") {
      await context.resume();
    }
    if (context.state !== "running") return;

    const nowAt = context.currentTime;
    const scheduleTone = (
      frequency: number,
      start: number,
      duration: number,
    ) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    };

    scheduleTone(660, nowAt, 0.34);
    scheduleTone(880, nowAt + 0.22, 0.46);
  }, [ensureAudioContext]);

  const hourAngle = now
    ? ((now.getHours() % 12) +
        now.getMinutes() / 60 +
        now.getSeconds() / 3600) *
      30
    : 0;
  const minuteAngle = now ? (now.getMinutes() + now.getSeconds() / 60) * 6 : 0;

  const hourRad = ((hourAngle - 90) * Math.PI) / 180;
  const minuteRad = ((minuteAngle - 90) * Math.PI) / 180;

  const hourHand = {
    x: 50 - 3 * Math.cos(hourRad),
    y: 50 - 3 * Math.sin(hourRad),
    length: 35,
  };

  const minuteHand = {
    x: 50 - 3 * Math.cos(minuteRad),
    y: 50 - 3 * Math.sin(minuteRad),
    length: 45,
  };

  const createHandPoints = (
    length: number,
    tailWidth: number,
    tipWidth: number,
    tipLength: number,
  ) => {
    const tipBaseY = -(length - tipLength);
    return `${-tailWidth},0 ${-tipWidth},${tipBaseY} ${tipWidth},${tipBaseY} ${tailWidth},0`;
  };

  const hourHandPoints = createHandPoints(hourHand.length, 1.0, 0.42, 2.2);
  const minuteHandPoints = createHandPoints(minuteHand.length, 0.8, 0.32, 2.6);

  const restTime = 30 - workTime;
  const workTimeRangePercent =
    ((workTime - WORK_TIME_MIN) / (WORK_TIME_MAX - WORK_TIME_MIN)) * 100;
  const segmentMinutes = [workTime, restTime, workTime, restTime];
  let passedMinutes = 0;

  const clockSectors = segmentMinutes.map((minutes, index) => {
    const startDeg = passedMinutes * 6;
    passedMinutes += minutes;
    const endDeg = passedMinutes * 6;

    return {
      path: createSectorPath(startDeg, endDeg),
      fill:
        index % 2 === 0
          ? "url(#workSectorGradient)"
          : "url(#restSectorGradient)",
    };
  });

  const workDurationSeconds = workTime * 60;
  const elapsedSecondsInBlock = now
    ? (now.getMinutes() % 30) * 60 + now.getSeconds()
    : 0;

  const isWorkTime = now ? elapsedSecondsInBlock < workDurationSeconds : false;

  useEffect(() => {
    if (!now) return;
    if (prevIsWorkTimeRef.current === null) {
      prevIsWorkTimeRef.current = isWorkTime;
      return;
    }
    if (prevIsWorkTimeRef.current !== isWorkTime && soundEnabled) {
      void playSwitchChime();
    }
    prevIsWorkTimeRef.current = isWorkTime;
  }, [isWorkTime, now, soundEnabled, playSwitchChime]);

  const remainingSeconds = now
    ? isWorkTime
      ? workDurationSeconds - elapsedSecondsInBlock
      : HALF_HOUR_SECONDS - elapsedSecondsInBlock
    : 0;

  const remainLabel = now ? formatMmSs(remainingSeconds) : "--:--";
  const tabStatusLabel = isWorkTime ? "作業" : "休憩";

  useEffect(() => {
    if (!now) return;
    document.title = `${tabStatusLabel}：${remainLabel}`;
  }, [now, tabStatusLabel, remainLabel]);

  const closeMenuWithAnimation = useCallback(() => {
    if (!menuDialogRef.current || !menuDialogRef.current.open) return;
    if (isDialogClosing) return;

    setIsDialogClosing(true);
    setIsDialogShown(false);
    dialogCloseAnimationRef.current?.cancel();
    const closeAnimation = menuDialogRef.current.animate(
      [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0, transform: "translateY(10px) scale(0.985)" },
      ],
      { duration: DIALOG_CLOSE_DURATION_MS, easing: "ease" },
    );
    dialogCloseAnimationRef.current = closeAnimation;
    closeAnimation.onfinish = () => {
      dialogCloseAnimationRef.current = null;
      menuDialogRef.current?.close();
      setIsDialogClosing(false);
      setIsInitialDialogOpen(false);
    };
    closeAnimation.oncancel = () => {
      dialogCloseAnimationRef.current = null;
    };
  }, [isDialogClosing]);

  const toggleMenu = useCallback(() => {
    if (!menuDialogRef.current) return;
    if (menuDialogRef.current.open) {
      closeMenuWithAnimation();
    } else {
      setIsDialogShown(true);
      menuDialogRef.current.showModal();
    }
  }, [closeMenuWithAnimation]);

  const handleDialogClick = useCallback(
    (event: MouseEvent<HTMLDialogElement>) => {
      if (!menuDialogRef.current) return;
      const rect = menuDialogRef.current.getBoundingClientRect();
      const clickedOutside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;

      if (clickedOutside && !pointerDownStartedInsideDialogRef.current) {
        closeMenuWithAnimation();
      }
      pointerDownStartedInsideDialogRef.current = false;
    },
    [closeMenuWithAnimation],
  );

  const handleDialogPointerDown = useCallback(
    (event: PointerEvent<HTMLDialogElement>) => {
      if (!menuDialogRef.current) return;
      const rect = menuDialogRef.current.getBoundingClientRect();
      pointerDownStartedInsideDialogRef.current =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
    },
    [],
  );

  const handleDialogCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement, Event>) => {
      event.preventDefault();
      closeMenuWithAnimation();
    },
    [closeMenuWithAnimation],
  );

  const handleDialogClose = useCallback(() => {
    dialogCloseAnimationRef.current = null;
    setIsDialogShown(false);
    setIsDialogClosing(false);
    setIsInitialDialogOpen(false);
  }, []);

  if (!now) {
    return null;
  }

  return (
    <div
      className={`${Style.container} ${isWorkTime ? Style.work : Style.rest}`}
    >
      <main className={Style.main}>
        <button
          className={Style.menuBtn}
          onClick={toggleMenu}
          aria-label="設定を開く"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="24px"
            viewBox="0 -960 960 960"
            width="24px"
            fill="currentColor"
          >
            <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z" />
          </svg>
        </button>

        <svg
          width="min(84vw, 620px)"
          height="min(84vw, 620px)"
          viewBox="0 0 100 100"
          className={Style.clock}
        >
          <defs>
            <linearGradient
              id="workSectorGradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#f89f94" />
              <stop offset="100%" stopColor="#ec7078" />
            </linearGradient>
            <linearGradient
              id="restSectorGradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#86b3ea" />
              <stop offset="100%" stopColor="#4f7fd1" />
            </linearGradient>
            <linearGradient
              id="clockRingGradient"
              gradientUnits="userSpaceOnUse"
              x1="2"
              y1="2"
              x2="98"
              y2="98"
            >
              <stop offset="0%" stopColor="#2e4864" />
              <stop offset="100%" stopColor="#1b334c" />
            </linearGradient>
            <linearGradient
              id="clockIndexGradient"
              gradientUnits="userSpaceOnUse"
              x1="50"
              y1="5"
              x2="50"
              y2="12"
            >
              <stop offset="0%" stopColor="#3f6282" />
              <stop offset="100%" stopColor="#1f3852" />
            </linearGradient>
            <linearGradient
              id="clockHandGradient"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="-45"
              x2="0"
              y2="0"
            >
              <stop offset="0%" stopColor="#456683" />
              <stop offset="100%" stopColor="#1f3852" />
            </linearGradient>
          </defs>

          {clockSectors.map((sector, i) => (
            <path
              key={i}
              d={sector.path}
              fill={sector.fill}
              className={Style.clockSector}
            ></path>
          ))}

          <circle
            cx="50"
            cy="50"
            r="48"
            fill="#ffffff08"
            stroke="url(#clockRingGradient)"
            strokeWidth="1.3"
            className={Style.clockCircle}
          ></circle>

          <g
            transform={`translate(${hourHand.x} ${hourHand.y}) rotate(${hourAngle})`}
          >
            <polygon
              points={hourHandPoints}
              className={Style.clockShortHand}
            ></polygon>
          </g>

          <g
            transform={`translate(${minuteHand.x} ${minuteHand.y}) rotate(${minuteAngle})`}
          >
            <polygon
              points={minuteHandPoints}
              className={Style.clockLongHand}
            ></polygon>
          </g>

          <circle cx="50" cy="50" r="1.9" className={Style.clockPin}></circle>

          {Array.from({ length: 60 }).map((_, i) => (
            <line
              key={i}
              x1="50"
              y1="5"
              x2="50"
              y2={i % 5 === 0 ? 11.5 : 7}
              stroke="url(#clockIndexGradient)"
              strokeWidth={i % 5 === 0 ? 1 : 0.75}
              transform={`rotate(${i * 6} 50 50)`}
              pathLength="1"
              className={Style.clockIndex}
            ></line>
          ))}

          <text
            x="50"
            y="69.8"
            textAnchor="middle"
            dominantBaseline="middle"
            className={Style.clockTextMain}
          >
            {remainLabel}
          </text>
        </svg>
      </main>

      <footer className={Style.footer}>
        <div className={Style.ad}>Pomodoro Chime</div>
      </footer>

      <div
        aria-hidden="true"
        className={`${Style.dialogOverlay} ${
          isDialogShown ? Style.dialogOverlayVisible : ""
        }`}
      ></div>

      <dialog
        ref={menuDialogRef}
        className={Style.menuDialog}
        onClose={handleDialogClose}
        onPointerDown={handleDialogPointerDown}
        onClick={handleDialogClick}
        onCancel={handleDialogCancel}
      >
        <div className={Style.workTimeSettingContainer}>
          <label htmlFor="work-time-range">{`作業時間 ${workTime}分`}</label>
          <input
            type="range"
            name="work-time-range"
            id="work-time-range"
            value={workTime}
            max={WORK_TIME_MAX}
            min={WORK_TIME_MIN}
            list="workTimeSetting"
            onChange={(e) => setWorkTime(Number(e.target.valueAsNumber))}
            style={
              {
                "--range-percent": `${workTimeRangePercent}%`,
              } as CSSProperties
            }
          />
          <div className={Style.rangeScale} aria-hidden="true">
            {RANGE_MARKS.map((mark) => (
              <button
                key={mark}
                type="button"
                className={Style.rangeMark}
                onClick={() => setWorkTime(mark)}
                style={{
                  left: `calc(10px + (100% - 20px) * ${(
                    (mark - WORK_TIME_MIN) /
                    (WORK_TIME_MAX - WORK_TIME_MIN)
                  ).toFixed(6)})`,
                }}
              >
                {mark}
              </button>
            ))}
          </div>
          <datalist id="workTimeSetting">
            {RANGE_MARKS.map((mark) => (
              <option key={mark} value={mark}></option>
            ))}
          </datalist>
        </div>

        <hr className={Style.hr} />

        <div className={Style.soundToggleContainer}>
          <label htmlFor="sound-toggle">作業/休憩 切り替えサウンド</label>
          <label
            className={Style.switch}
            aria-label="作業/休憩 切り替えサウンドON/OFF"
          >
            <input
              type="checkbox"
              name="sound-toggle"
              id="sound-toggle"
              checked={soundEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setSoundEnabled(enabled);
                if (enabled) {
                  void playSwitchChime();
                }
              }}
            />
            <span className={Style.switchSlider}></span>
          </label>
        </div>

        <hr className={Style.hr} />

        <article className={Style.manualContainer}>
          <h2>時報ポモドーロタイマー</h2>
          <p>
            毎時00分と30分に作業を開始し、
            <br />
            設定した作業時間の残りを休憩時間にします。
          </p>
        </article>

        <div className={Style.officialLinkContainer}>
          <svg
            className={Style.openInNewIcon}
            xmlns="http://www.w3.org/2000/svg"
            height="24px"
            viewBox="0 -960 960 960"
            width="24px"
            fill="currentColor"
          >
            <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z" />
          </svg>
          <a
            href="https://katom826.github.io/"
            target="_blank"
            rel="noreferrer"
          >
            作者公式ページ
          </a>
        </div>

        <button
          ref={menuCloseBtnRef}
          onClick={toggleMenu}
          className={Style.menuCloseBtn}
        >
          {isInitialDialogOpen ? "始める" : "閉じる"}
        </button>
      </dialog>
    </div>
  );
}
