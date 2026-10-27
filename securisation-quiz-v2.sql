
-- EDUCONNECT CI
-- Version 2 : preparation de la securisation du quiz.
-- Ne pas executer avant validation de l'ensemble SQL + JavaScript.

BEGIN;

-- Table privee des tentatives
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
    used_at timestamptz
);

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quiz_attempts
FROM PUBLIC, anon, authenticated;

-- Demarrer une tentative
CREATE OR REPLACE FUNCTION public.demarrer_tentative_quiz_informatique()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_attempt_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Vous devez etre connecte.';
    END IF;

    INSERT INTO public.quiz_attempts (user_id, course_id)
    VALUES (v_user_id, 'informatique')
    RETURNING id INTO v_attempt_id;

    RETURN v_attempt_id;
END;
$function$;

-- Soumettre une tentative
CREATE OR REPLACE FUNCTION public.soumettre_tentative_quiz_informatique(
    tentative_id uuid,
    reponse_q1 text,
    reponse_q2 text,
    reponse_q3 text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_score integer := 0;
    v_attempt public.quiz_attempts%ROWTYPE;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Vous devez etre connecte.';
    END IF;

    SELECT *
    INTO v_attempt
    FROM public.quiz_attempts
    WHERE id = tentative_id
      AND user_id = v_user_id
      AND course_id = 'informatique'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tentative invalide.';
    END IF;

    IF v_attempt.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'Tentative deja utilisee.';
    END IF;

    IF v_attempt.expires_at <= now() THEN
        RAISE EXCEPTION 'Tentative expiree.';
    END IF;

    IF reponse_q1 IS NULL OR reponse_q1 NOT IN ('a', 'b', 'c')
       OR reponse_q2 IS NULL OR reponse_q2 NOT IN ('a', 'b', 'c')
       OR reponse_q3 IS NULL OR reponse_q3 NOT IN ('a', 'b', 'c') THEN
        RAISE EXCEPTION 'Reponses invalides.';
    END IF;

    IF reponse_q1 = 'b' THEN
        v_score := v_score + 1;
    END IF;

    IF reponse_q2 = 'a' THEN
        v_score := v_score + 1;
    END IF;

    IF reponse_q3 = 'c' THEN
        v_score := v_score + 1;
    END IF;

    UPDATE public.quiz_attempts
    SET used_at = now()
    WHERE id = tentative_id;

    INSERT INTO public.course_progress (
        user_id, course_id, score, updated_at
    )
    VALUES (
        v_user_id, 'informatique', v_score, now()
    )
    ON CONFLICT (user_id, course_id)
    DO UPDATE SET
        score = EXCLUDED.score,
        updated_at = EXCLUDED.updated_at
    WHERE public.course_progress.user_id = v_user_id;

    RETURN v_score;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.demarrer_tentative_quiz_informatique()
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION
    public.soumettre_tentative_quiz_informatique(uuid, text, text, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
    public.demarrer_tentative_quiz_informatique()
TO authenticated;

GRANT EXECUTE ON FUNCTION
    public.soumettre_tentative_quiz_informatique(uuid, text, text, text)
TO authenticated;

COMMIT;
