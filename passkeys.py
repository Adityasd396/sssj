"""WebAuthn ceremonies with server-stored, single-use, session-bound challenges."""

import hashlib
import json
import os
import secrets
from urllib.parse import urlsplit

from flask import abort, jsonify, redirect, render_template, request, session, url_for
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)


def install(app, db, User, login_required, audit, now):
    class Passkey(db.Model):
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
        credential_id = db.Column(db.Text, nullable=False, unique=True)
        public_key = db.Column(db.LargeBinary, nullable=False)
        user_handle = db.Column(db.LargeBinary, nullable=False)
        sign_count = db.Column(db.Integer, default=0, nullable=False)
        name = db.Column(db.String(80), nullable=False)
        created_at = db.Column(db.DateTime, default=now)
        last_used = db.Column(db.DateTime)

    class PasskeyChallenge(db.Model):
        id = db.Column(db.String(64), primary_key=True)
        binding = db.Column(db.String(64), nullable=False)
        challenge = db.Column(db.LargeBinary, nullable=False)
        purpose = db.Column(db.String(20), nullable=False)
        user_id = db.Column(db.Integer)
        user_handle = db.Column(db.LargeBinary)
        expires = db.Column(db.DateTime, nullable=False)

    def configuration():
        origin = os.environ.get("PASSKEY_ORIGIN", "")
        rp = os.environ.get("PASSKEY_RP_ID", "")
        if not origin and request.host.split(":")[0] == "localhost":
            origin, rp = request.host_url.rstrip("/"), "localhost"
        parsed = urlsplit(origin)
        if (
            not rp
            or parsed.hostname != rp
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or parsed.username
            or (parsed.scheme != "https" and not (parsed.scheme == "http" and rp == "localhost"))
        ):
            raise ValueError(
                "Passkeys need the shop’s HTTPS address configured. Password login is available."
            )
        if request.host != parsed.netloc or request.scheme != parsed.scheme:
            raise ValueError("Open the configured shop address to use passkeys.")
        return rp, origin.rstrip("/")

    def binding():
        if "passkey_binding" not in session:
            session["passkey_binding"] = secrets.token_hex(32)
        return hashlib.sha256(session["passkey_binding"].encode()).hexdigest()

    def issue(options, purpose, user=None, handle=None):
        from datetime import timedelta

        PasskeyChallenge.query.filter(PasskeyChallenge.expires < now()).delete()
        PasskeyChallenge.query.filter_by(binding=binding(), purpose=purpose).delete()
        row = PasskeyChallenge(
            id=secrets.token_hex(32),
            binding=binding(),
            challenge=options.challenge,
            purpose=purpose,
            user_id=user.id if user else None,
            user_handle=handle,
            expires=now() + timedelta(minutes=3),
        )
        db.session.add(row)
        db.session.commit()
        session["passkey_" + purpose] = row.id
        return jsonify(json.loads(options_to_json(options)))

    def consume(purpose):
        key = session.pop("passkey_" + purpose, None)
        row = db.session.get(PasskeyChallenge, key) if key else None
        if not row or row.binding != binding() or row.purpose != purpose or row.expires < now():
            raise ValueError("This request expired. Please try again.")
        values = (row.challenge, row.user_id, row.user_handle)
        claimed = PasskeyChallenge.query.filter_by(id=row.id, binding=binding()).delete()
        db.session.commit()
        if claimed != 1:
            raise ValueError("This request was already used. Please try again.")
        return values

    @app.route("/account/passkeys")
    @login_required
    def passkeys():
        return render_template(
            "passkeys.html", keys=Passkey.query.filter_by(user_id=session["user_id"]).all()
        )

    @app.route("/passkeys/register/options", methods=["POST"])
    @login_required
    def passkey_register_options():
        try:
            rp, _ = configuration()
            user = db.session.get(User, session["user_id"])
            if not user.check_password((request.get_json(silent=True) or {}).get("password", "")):
                return jsonify(error="Confirm your current password to add a passkey."), 403
            keys = Passkey.query.filter_by(user_id=user.id).all()
            if len(keys) >= 10:
                raise ValueError("Remove an unused passkey before adding another (maximum 10).")
            handle = keys[0].user_handle if keys else secrets.token_bytes(32)
            options = generate_registration_options(
                rp_id=rp,
                rp_name="Jewellery workspace",
                user_id=handle,
                user_name=user.username,
                authenticator_selection=AuthenticatorSelectionCriteria(
                    resident_key=ResidentKeyRequirement.REQUIRED,
                    user_verification=UserVerificationRequirement.REQUIRED,
                ),
                exclude_credentials=[
                    PublicKeyCredentialDescriptor(id=base64url_to_bytes(k.credential_id))
                    for k in keys
                ],
            )
            return issue(options, "register", user, handle)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400

    @app.route("/passkeys/register/verify", methods=["POST"])
    @login_required
    def passkey_register_verify():
        try:
            rp, origin = configuration()
            challenge, uid, handle = consume("register")
            if uid != session["user_id"]:
                raise ValueError("Account changed. Start again.")
            data = request.get_json() or {}
            verified = verify_registration_response(
                credential=data["credential"],
                expected_challenge=challenge,
                expected_rp_id=rp,
                expected_origin=origin,
                require_user_verification=True,
            )
            db.session.add(
                Passkey(
                    user_id=uid,
                    user_handle=handle,
                    credential_id=bytes_to_base64url(verified.credential_id),
                    public_key=verified.credential_public_key,
                    sign_count=verified.sign_count,
                    name=(data.get("name") or "My device").strip()[:80] or "My device",
                )
            )
            audit("create", "Passkey", None, "Registered a passkey")
            db.session.commit()
            return jsonify(ok=True)
        except Exception:
            db.session.rollback()
            return jsonify(
                error="Could not verify this passkey. Start again or use another device."
            ), 400

    @app.route("/passkeys/login/options", methods=["POST"])
    def passkey_login_options():
        try:
            rp, _ = configuration()
            return issue(
                generate_authentication_options(
                    rp_id=rp, user_verification=UserVerificationRequirement.REQUIRED
                ),
                "login",
            )
        except ValueError as exc:
            return jsonify(error=str(exc)), 400

    @app.route("/passkeys/login/verify", methods=["POST"])
    def passkey_login_verify():
        login_started = False
        try:
            rp, origin = configuration()
            challenge, _, _ = consume("login")
            data = request.get_json() or {}
            key = Passkey.query.filter_by(credential_id=data["id"]).first()
            if not key:
                raise ValueError("Unknown credential")
            user = db.session.get(User, key.user_id)
            handle = data.get("response", {}).get("userHandle")
            if not user or not handle or base64url_to_bytes(handle) != key.user_handle:
                raise ValueError("Account mismatch")
            verified = verify_authentication_response(
                credential=data,
                expected_challenge=challenge,
                expected_rp_id=rp,
                expected_origin=origin,
                credential_public_key=key.public_key,
                credential_current_sign_count=key.sign_count,
                require_user_verification=True,
            )
            # Serialise concurrent credential usage, including authenticators with zero counters.
            changed = Passkey.query.filter_by(id=key.id, sign_count=key.sign_count).update(
                {Passkey.sign_count: verified.new_sign_count, Passkey.last_used: now()}
            )
            if changed != 1:
                raise ValueError("Credential changed")
            user.last_login = now()
            login_started = True
            session.clear()
            session.update(
                user_id=user.id,
                username=user.username,
                is_admin=user.is_admin,
                auth_version=user.auth_version,
            )
            audit("login", "Passkey", key.id, "Signed in with passkey")
            db.session.commit()
            return jsonify(ok=True, redirect=url_for("index"))
        except Exception:
            db.session.rollback()
            if login_started:
                session.clear()
            return jsonify(
                error="Passkey sign-in failed. Please try again or use your password."
            ), 400

    @app.route("/account/passkeys/<int:key_id>/delete", methods=["POST"])
    @login_required
    def passkey_delete(key_id):
        user = db.session.get(User, session["user_id"])
        if not user.check_password(request.form.get("password", "")):
            abort(403, "Confirm your password to remove a passkey.")
        key = Passkey.query.filter_by(id=key_id, user_id=user.id).first_or_404()
        db.session.delete(key)
        audit("delete", "Passkey", key.id, "Removed a passkey")
        db.session.commit()
        return redirect(url_for("passkeys"))

    return Passkey, PasskeyChallenge
