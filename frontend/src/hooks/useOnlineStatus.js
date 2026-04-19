import { useState, useEffect, useRef } from 'react';

const PING_URL      = '/api/health';
const PING_INTERVAL = 12000; // verificar cada 12 seg
const PING_TIMEOUT  = 5000;  // si no responde en 5 seg → offline

async function pingServer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
  try {
    const res = await fetch(PING_URL, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const intervalRef = useRef(null);

  const check = async () => {
    const result = await pingServer();
    setOnline(result);
  };

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, PING_INTERVAL);

    const goOnline  = () => check();   // re-verificar con ping real
    const goOffline = () => setOnline(false);

    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      clearInterval(intervalRef.current);
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []); // eslint-disable-line

  return online;
}
