import { useEffect, RefObject } from "react";

export const useAutoResizeTextarea = (
  textareaRef: RefObject<HTMLTextAreaElement>,
  value: string
) => {
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = "auto";

    // Set height to scrollHeight (content height)
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, textareaRef]);
};
