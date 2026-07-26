"use client";

import { Toaster } from "sonner";

export default function FeedbackProvider() {
  return (
    <Toaster
      closeButton
      richColors
      position="bottom-right"
      visibleToasts={4}
      toastOptions={{
        duration: 5000,
        className: "kelpie-toast",
        descriptionClassName: "kelpie-toast-description",
      }}
    />
  );
}
