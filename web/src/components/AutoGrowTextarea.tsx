import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// A controlled textarea that grows to fit its content; `rows` sets the min height, CSS `max-height` caps it.
export function AutoGrowTextarea({ value, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      className={className ? `autogrow ${className}` : "autogrow"}
      {...rest}
    />
  );
}
