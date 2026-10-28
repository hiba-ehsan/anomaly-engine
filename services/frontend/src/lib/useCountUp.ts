'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

export function useCountUp(target: number, duration = 1.4, start = true): number {
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;

    const obj = { v: 0 };
    const tween = gsap.to(obj, {
      v: target,
      duration,
      ease: 'power2.out',
      onUpdate: () => setValue(obj.v),
    });
    return () => { tween.kill(); };
  }, [target, duration, start]);

  return value;
}
