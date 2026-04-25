import { animalEmoji, type PublicPlayer } from "../party/protocol";

/** Profile photo in player list, or animal emoji as fallback. */
export default function PlayerRowFace({ player }: { player: PublicPlayer }) {
  const src = player.avatarUrl;
  if (src) {
    return (
      <img
        className="player-avatar"
        src={src}
        alt=""
        width={36}
        height={36}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <span className="player-avatar-fallback" aria-hidden>{animalEmoji(player.animal)}</span>;
}
