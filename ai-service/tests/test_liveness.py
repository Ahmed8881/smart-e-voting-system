import pytest

from app.liveness import (
    Action,
    ChallengeError,
    FrameSignals,
    evaluate,
    issue_challenge,
    parse_challenge,
)

SECRET = b"k" * 32


def frames(*specs: tuple[float, float]) -> list[FrameSignals]:
    """Each spec is (blink, yaw) for one tracked frame."""
    return [FrameSignals(faces=1, blink=b, yaw=y) for b, y in specs]


OPEN, CLOSED = 0.1, 0.8
FRONT, LEFT, RIGHT = 0.0, 30.0, -30.0


class TestChallenge:
    def test_always_a_blink_plus_one_turn(self):
        for _ in range(30):
            _, c = issue_challenge(SECRET)
            assert sorted(c.actions) in (
                sorted([Action.BLINK, Action.TURN_LEFT]),
                sorted([Action.BLINK, Action.TURN_RIGHT]),
            )

    def test_round_trip(self):
        token, issued = issue_challenge(SECRET, now=1000)
        assert parse_challenge(SECRET, token, now=1050) == issued

    def test_expired(self):
        token, _ = issue_challenge(SECRET, now=1000)
        with pytest.raises(ChallengeError, match="expired"):
            parse_challenge(SECRET, token, now=1000 + 121)

    def test_tampered_actions_are_rejected(self):
        token, _ = issue_challenge(SECRET)
        body, sig = token.split(".")
        with pytest.raises(ChallengeError):
            parse_challenge(SECRET, f"{body[:-2]}xx.{sig}")

    def test_wrong_secret(self):
        token, _ = issue_challenge(SECRET)
        with pytest.raises(ChallengeError, match="signature"):
            parse_challenge(b"other" * 8, token)

    @pytest.mark.parametrize("token", ["", "abc", "a.b.c", "!!!.???"])
    def test_garbage(self, token):
        with pytest.raises(ChallengeError):
            parse_challenge(SECRET, token)


class TestEvaluate:
    def test_blink_then_turn_left_passes(self):
        seq = frames(
            (OPEN, FRONT), (CLOSED, FRONT), (OPEN, FRONT), (OPEN, 10), (OPEN, LEFT), (OPEN, FRONT)
        )
        result = evaluate([Action.BLINK, Action.TURN_LEFT], seq)
        assert result.live
        assert result.completed == [Action.BLINK, Action.TURN_LEFT]

    def test_turn_right_then_blink_passes(self):
        seq = frames(
            (OPEN, FRONT),
            (OPEN, RIGHT),
            (OPEN, FRONT),
            (CLOSED, FRONT),
            (OPEN, FRONT),
            (OPEN, FRONT),
        )
        assert evaluate([Action.TURN_RIGHT, Action.BLINK], seq).live

    def test_static_photo_fails(self):
        seq = frames(*[(OPEN, FRONT)] * 10)
        result = evaluate([Action.BLINK, Action.TURN_LEFT], seq)
        assert not result.live
        assert result.reason == "ACTION_NOT_DETECTED:BLINK"

    def test_wrong_direction_fails(self):
        seq = frames(
            (OPEN, FRONT),
            (CLOSED, FRONT),
            (OPEN, FRONT),
            (OPEN, RIGHT),
            (OPEN, FRONT),
            (OPEN, FRONT),
        )
        assert (
            evaluate([Action.BLINK, Action.TURN_LEFT], seq).reason
            == "ACTION_NOT_DETECTED:TURN_LEFT"
        )

    def test_actions_out_of_order_fail(self):
        seq = frames(
            (OPEN, FRONT),
            (OPEN, LEFT),
            (OPEN, FRONT),
            (CLOSED, FRONT),
            (OPEN, FRONT),
            (OPEN, FRONT),
        )
        assert not evaluate([Action.BLINK, Action.TURN_LEFT], seq).live

    def test_photo_held_at_an_angle_is_not_a_turn(self):
        # Never frontal: a tilted print shows a constant yaw, not a movement.
        seq = frames(
            (OPEN, LEFT), (CLOSED, LEFT), (OPEN, LEFT), (OPEN, LEFT), (OPEN, LEFT), (OPEN, LEFT)
        )
        assert (
            evaluate([Action.BLINK, Action.TURN_LEFT], seq).reason
            == "ACTION_NOT_DETECTED:TURN_LEFT"
        )

    def test_closed_eyes_without_reopening_is_not_a_blink(self):
        seq = frames(
            (OPEN, FRONT),
            (CLOSED, FRONT),
            (CLOSED, FRONT),
            (CLOSED, LEFT),
            (CLOSED, FRONT),
            (CLOSED, FRONT),
        )
        assert evaluate([Action.BLINK], seq).reason == "ACTION_NOT_DETECTED:BLINK"

    def test_too_few_frames(self):
        assert evaluate([Action.BLINK], frames((OPEN, FRONT))).reason == "TOO_FEW_FRAMES"

    def test_second_face_in_any_frame_fails(self):
        seq = frames(*[(OPEN, FRONT)] * 6) + [FrameSignals(faces=2)]
        assert evaluate([Action.BLINK], seq).reason == "MULTIPLE_FACES"

    def test_mostly_untracked_fails(self):
        seq = frames(*[(OPEN, FRONT)] * 4) + [FrameSignals(faces=0)] * 3
        assert evaluate([Action.BLINK], seq).reason == "FACE_NOT_TRACKED"
