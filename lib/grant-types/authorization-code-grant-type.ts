import { InvalidArgumentError } from '../errors/invalid-argument-error';
import { InvalidGrantError } from '../errors/invalid-grant-error';
import { InvalidRequestError } from '../errors/invalid-request-error';
import { ServerError } from '../errors/server-error';
import { Client } from '../interfaces/client.interface';
import { Token } from '../interfaces/token.interface';
import { User } from '../interfaces/user.interface';
import { Request } from '../request';
import * as is from '../validator/is';
import { AbstractGrantType } from './abstract-grant-type';

export class AuthorizationCodeGrantType extends AbstractGrantType {
  constructor(options: any = {}) {
    super(options);
    if (!options.model) {
      throw new InvalidArgumentError('Missing parameter: `model`');
    }

    if (!options.model.getAuthorizationCode) {
      throw new InvalidArgumentError(
        'Invalid argument: model does not implement `getAuthorizationCode()`',
      );
    }

    if (!options.model.revokeAuthorizationCode) {
      throw new InvalidArgumentError(
        'Invalid argument: model does not implement `revokeAuthorizationCode()`',
      );
    }

    if (!options.model.saveToken) {
      throw new InvalidArgumentError(
        'Invalid argument: model does not implement `saveToken()`',
      );
    }
  }

  /**
   * Handle authorization code grant.
   *
   * @see https://tools.ietf.org/html/rfc6749#section-4.1.3
   */

  async handle(request: Request, client) {
    if (!request) {
      throw new InvalidArgumentError('Missing parameter: `request`');
    }

    if (!client) {
      throw new InvalidArgumentError('Missing parameter: `client`');
    }
    const code = await this.getAuthorizationCode(request, client);
    this.validateRedirectUri(request, code);
    await this.revokeAuthorizationCode(code);

    return this.saveToken(
      code.user,
      client,
      code.authorizationCode,
      code.scope,
    );
  }

  /**
   * Get the authorization code.
   */

  async getAuthorizationCode(request: Request, client) {
    if (!request.body.code) {
      throw new InvalidRequestError('Missing parameter: `code`');
    }

    if (!is.vschar(request.body.code)) {
      throw new InvalidRequestError('Invalid parameter: `code`');
    }

    const code = await this.model.getAuthorizationCode(request.body.code);
    if (!code) {
      throw new InvalidGrantError(
        'Invalid grant: authorization code is invalid',
      );
    }

    if (!code.client) {
      throw new ServerError(
        'Server error: `getAuthorizationCode()` did not return a `client` object',
      );
    }

    if (!code.user) {
      throw new ServerError(
        'Server error: `getAuthorizationCode()` did not return a `user` object',
      );
    }

    if (code.client.id !== client.id) {
      throw new InvalidGrantError(
        'Invalid grant: authorization code is invalid',
      );
    }

    if (!(code.expiresAt instanceof Date)) {
      throw new ServerError(
        'Server error: `expiresAt` must be a Date instance',
      );
    }

    if (code.expiresAt < new Date()) {
      throw new InvalidGrantError(
        'Invalid grant: authorization code has expired',
      );
    }

    if (code.redirectUri && !is.uri(code.redirectUri)) {
      throw new InvalidGrantError(
        'Invalid grant: `redirect_uri` is not a valid URI',
      );
    }

    return code;
  }

  /**
   * Validate the redirect URI.
   *
   * "The authorization server MUST ensure that the redirect_uri parameter is
   * present if the redirect_uri parameter was included in the initial
   * authorization request as described in Section 4.1.1, and if included
   * ensure that their values are identical."
   *
   * @see https://tools.ietf.org/html/rfc6749#section-4.1.3
   */

  validateRedirectUri = (request: Request, code) => {
    if (!code.redirectUri) {
      return;
    }

    const redirectUri = request.body.redirect_uri || request.query.redirect_uri;

    if (!is.uri(redirectUri)) {
      throw new InvalidRequestError(
        'Invalid request: `redirect_uri` is not a valid URI',
      );
    }

    if (redirectUri !== code.redirectUri) {
      throw new InvalidRequestError(
        'Invalid request: `redirect_uri` is invalid',
      );
    }
  };

  /**
   * Revoke the authorization code.
   *
   * "The authorization code MUST expire shortly after it is issued to mitigate
   * the risk of leaks. [...] If an authorization code is used more than once,
   * the authorization server MUST deny the request."
   *
   * @see https://tools.ietf.org/html/rfc6749#section-4.1.2
   */

  async revokeAuthorizationCode(code) {
    const status = await this.model.revokeAuthorizationCode(code);
    if (!status) {
      throw new InvalidGrantError(
        'Invalid grant: authorization code is invalid',
      );
    }

    return code;
  }

  /**
   * Save token.
   */

  async saveToken(
    user: User,
    client: Client,
    authorizationCode: string,
    scope: string,
  ) {
    const fns = [
      this.validateScope(user, client, scope),
      this.generateAccessToken(client, user, scope),
      this.generateRefreshToken(client, user, scope),
      this.getAccessTokenExpiresAt(),
      this.getRefreshTokenExpiresAt(),
    ];

    const [
      accessScope,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    ] = await Promise.all(fns as any);

    const token: Token = {
      accessToken,
      authorizationCode,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
      scope: accessScope,
    } as any;

    return this.model.saveToken(token, client, user);
  }
}
