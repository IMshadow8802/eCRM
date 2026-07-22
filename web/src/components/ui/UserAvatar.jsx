import Avatar from "./Avatar";
import { useUserDirectory } from "../../hooks/useUserDirectory";

// Avatar that resolves its preset from the company directory by userId — used
// in feeds where the row carries a UserId but not the avatar. Falls back to the
// passed name's initials when the user isn't in the directory yet.
export default function UserAvatar({ userId, name, ...rest }) {
  const dir = useUserDirectory();
  const u = userId != null ? dir.get(userId) : null;
  return <Avatar name={u?.FullName ?? name} preset={u?.Avatar} {...rest} />;
}
