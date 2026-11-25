import { useEffect, useState } from 'react';

// A window as narrow as a phone's (under 768 px, where the console has its tab bar): true or
// false, again whenever the window changes. False where the browser cannot tell.
const QUERY = '(max-width: 767px)';

const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;

export function usePhone() {
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(QUERY);
    const on = () => setPhone(list.matches);
    on();
    list.addEventListener('change', on);
    return () => list.removeEventListener('change', on);
  }, []);
  return phone;
}
