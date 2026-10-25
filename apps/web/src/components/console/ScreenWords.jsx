// Steps that name what to press on a screen: each [word] in brackets is drawn as that screen's own
// label (`.c-ui`), so it reads as a thing to find and press, not as part of the sentence (Kd's
// click-through of 18d-iii-b-i: "SHOULD BE LIKE BUTTON WITH A DIFFERENT COLOUR").

export default function ScreenWords({ text, className, style }) {
  const parts = text.split(/(\[[^\]]+\])/);
  return (
    <span className={className} style={style} data-words="">
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') && part.length > 2 ? (
          <span key={`${String(i)}${part}`} className="c-ui">
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}
