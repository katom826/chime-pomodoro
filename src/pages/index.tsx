import { useEffect, useState } from "react";

export default function Home() {
  const [now, setNow] = useState(new Date());
  const [status, setStatus] = useState<"作業中" | "休憩中">("作業中");
  const [remaining, setRemaining] = useState<string>("--:--");

  const pad = (num: number) => num.toString().padStart(2, "0");

  useEffect(() => {
    const update = () => {
      const current = new Date();
      setNow(current);

      const minutes = current.getMinutes();
      const seconds = current.getSeconds();

      let newStatus: "作業中" | "休憩中";
      let remainingMinutes: number;

      if (minutes < 25) {
        newStatus = "作業中";
        remainingMinutes = 25 - minutes - 1;
      } else if (minutes < 30) {
        newStatus = "休憩中";
        remainingMinutes = 30 - minutes - 1;
      } else if (minutes < 55) {
        newStatus = "作業中";
        remainingMinutes = 55 - minutes - 1;
      } else {
        newStatus = "休憩中";
        remainingMinutes = 60 - minutes - 1;
      }

      const remainingSeconds = 59 - seconds;
      setStatus(newStatus);
      setRemaining(`${pad(remainingMinutes)}:${pad(remainingSeconds)}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`h-[100dvh] flex items-center justify-center flex-col ${
        status === "作業中" ? "bg-red-500" : "bg-blue-500"
      }`}
    >
      <h1>時報ポモドーロ</h1>
      <p>{status}</p>
      <p>
        時刻：{pad(now.getHours())}:{pad(now.getMinutes())}:
        {pad(now.getSeconds())}
      </p>
      <p>残り：{remaining}</p>
    </div>
  );
}
