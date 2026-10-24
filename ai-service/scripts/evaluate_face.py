"""Measures SFace verification accuracy on LFW (Labeled Faces in the Wild) pairs — deviation D6.

    python scripts/evaluate_face.py [--threshold 0.363]

Downloads LFW via scikit-learn on first run (~200 MB, cached in ~/scikit_learn_data). Uses the
standard 'test' split (1000 pairs: 500 same person, 500 different). Reports, at the threshold:
  FAR — false accept rate: different people wrongly matched (impersonation risk)
  FRR — false reject rate: the same person wrongly rejected (usability cost)
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from sklearn.datasets import fetch_lfw_pairs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.face_engine import FaceEngine  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.363)
    args = parser.parse_args()

    # Full colour, uncropped 250x250 images so YuNet can detect and align the face itself.
    pairs = fetch_lfw_pairs(subset="test", color=True, resize=1.0, slice_=None)
    engine = FaceEngine(Path(__file__).resolve().parent.parent / "models")

    def embed(image: np.ndarray) -> np.ndarray | None:
        # scikit-learn returns pixels scaled to 0..1
        bgr = cv2.cvtColor(np.clip(image * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
        bgr = cv2.resize(bgr, None, fx=2, fy=2)  # LFW faces are ~110 px; engine needs >= 80
        return engine.embed_largest_face(bgr)

    scores, labels, skipped = [], [], 0
    for (a, b), same in zip(pairs.pairs, pairs.target, strict=True):
        ea, eb = embed(a), embed(b)
        if ea is None or eb is None:
            skipped += 1
            continue
        scores.append(float(ea @ eb))
        labels.append(bool(same))

    if not scores:
        print(f"no pairs could be evaluated (skipped {skipped})", file=sys.stderr)
        return 1
    s, y = np.array(scores), np.array(labels, dtype=bool)
    far = float(np.mean(s[~y] >= args.threshold))
    frr = float(np.mean(s[y] < args.threshold))
    print(f"pairs evaluated: {len(s)} (skipped {skipped}: no face of at least 80 px detected)")
    print(f"threshold:       {args.threshold}")
    print(f"FAR:             {far:.2%}  ({int(np.sum(s[~y] >= args.threshold))}/{int(np.sum(~y))})")
    print(f"FRR:             {frr:.2%}  ({int(np.sum(s[y] < args.threshold))}/{int(np.sum(y))})")
    print(f"accuracy:        {np.mean((s >= args.threshold) == y):.2%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
