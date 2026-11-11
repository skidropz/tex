<?php
declare(strict_types=1);
/** Roles are provisioned server-side only. No HTTP route grants/revokes an admin role. */
function tex_is_admin(int $uid): bool
{
    $st=db()->prepare('SELECT is_admin FROM account_flags WHERE user_id=?');
    $st->execute([$uid]); return (int)$st->fetchColumn()===1;
}
function tex_require_admin(int $uid): void
{
    if (!tex_is_admin($uid)) json_error('Acces nepermis.',403);
}

/** Public presentation only. Never use this value for authorization. */
function tex_display_label($label): string
{
    // TESTER is the compact internal value for the visual label PRODUCT TESTER.
    return in_array($label, ['ADMIN','MOD','TESTER'], true) ? $label : '';
}
