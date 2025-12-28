export const verifyPodcastPassword = (password: string): boolean => {
  return password === "1234" || password === "admin";
};
