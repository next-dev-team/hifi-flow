import React from "react";

interface ApiDebugProps<TData = unknown, TError = unknown> {
  title?: string;
  data?: TData;
  error?: TError;
}

export function ApiDebug<TData = unknown, TError = unknown>({
  title,
  data,
  error,
}: ApiDebugProps<TData, TError>) {
  void title;
  void data;
  void error;
  return null;
}
