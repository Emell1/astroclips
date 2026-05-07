import { useState, useEffect } from "react";
import { getMe, logout as doLogout, type User } from "../lib/auth";

export function useAuth() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    getMe().then(setUser);
  }, []);

  const logout = async () => {
    await doLogout();
    setUser(null);
  };

  return { user, setUser, logout, loading: user === undefined };
}
