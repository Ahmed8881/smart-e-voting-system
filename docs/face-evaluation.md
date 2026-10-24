# Face recognition accuracy (deviation D6)

The system uses OpenCV's pretrained **SFace** model (`face_recognition_sface_2021dec`) with **YuNet**
for detection and alignment, instead of training a model on VGGFace2 as the proposal suggested.
This page records how well that model performs at the threshold the system uses.

## Method

- Benchmark: **LFW** (Labeled Faces in the Wild), standard `test` split — 1000 pairs, 500 of the same
  person and 500 of different people. Loaded with scikit-learn (`fetch_lfw_pairs`, full colour,
  uncropped 250×250).
- Each image is upscaled 2× (LFW faces are ~110 px), YuNet detects the faces, the **largest** face is
  aligned and embedded with SFace, and the two embeddings are compared by cosine similarity.
- Threshold: **0.363**, the value published with the OpenCV model and the system default
  (`face.matchThreshold`, editable in admin settings).
- Reproduce: `cd ai-service && python scripts/evaluate_face.py [--threshold 0.363]`

## Result (2026-10-24)

| Metric | Value | Meaning |
|---|---|---|
| Pairs evaluated | 1000 / 1000 | |
| **FAR** (false accept rate) | **0.00 %** (0 / 500) | different people wrongly matched — impersonation risk |
| **FRR** (false reject rate) | **2.60 %** (13 / 500) | same person wrongly rejected — the voter retries |
| Accuracy | 98.70 % | |

For voting, FAR is the number that matters most (an impostor must never pass); a 2.6 % FRR means
roughly one login attempt in 40 needs a retry. Raising the threshold lowers FAR further at the cost
of FRR.

## Limits — state these honestly in the report

- LFW is celebrity press photos, not webcam selfies. Webcam lighting and camera quality will move
  both numbers; the threshold should be re-checked with real registrations during testing.
- 1000 pairs can show that FAR is low, not that it is zero: 0/500 means the true rate is below
  ~0.6 % with 95 % confidence (rule of three: 3/500).
- Recognition accuracy says nothing about spoofing. That is handled separately by the liveness
  challenge (blink + head turn, see `ai-service/app/liveness.py`), which is tested against static
  photos and a simulated photo-of-a-photo attack in `ai-service/tests/test_face_api.py`.
- In the voter flow a frame with more than one face is rejected; the benchmark instead uses the
  largest face, as is standard for LFW, because many LFW photos contain bystanders.
