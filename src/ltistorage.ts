interface OidcLoginData {
    state: string;
    nonce: string;
    scope: string;
    response_type: string;
    response_mode: string;
    prompt: string;
    client_id: string;
    login_hint: string;
    lti_message_hint: string;
    redirect_uri: URL;
}
interface OidcLoginFormData {
    target: string;
    url: URL;
    params: OidcLoginData;
}
interface LtiPostMessageData {
    subject: string;
    [x: string]: any;
}

class LtiStorage {
    static cookiePrefix = 'lti';
    #debug: boolean;

    constructor(debug: boolean) {
        this.#debug = debug;
    }

    async initToolLogin(platformOidcLoginUrl: URL, oidcLoginData: OidcLoginData, launchFrame: Window|undefined): Promise<void> {
        return this.setStateAndNonce(platformOidcLoginUrl, oidcLoginData, launchFrame)
        .then(this.doLoginInitiationRedirect);
    }

    async setStateAndNonce(platformOidcLoginUrl: URL, oidcLoginData: OidcLoginData, launchFrame: Window|undefined): Promise<OidcLoginFormData> {
        let launchWindow = launchFrame||window;
        let state = LtiPostMessage.secureRandom();
        let nonce = LtiPostMessage.secureRandom();

        return new Promise ((resolve, reject) => {
            let params = new URLSearchParams(window.location.search);
            return resolve(params.has('lti_storage_target'));
        })
        .then(async (hasPlatformStorage) => {
            if (hasPlatformStorage) {
                let platformStorage = this.ltiPostMessage(new URL(platformOidcLoginUrl.origin), launchWindow);
                return platformStorage.putData(LtiStorage.cookiePrefix + '_state_' + state, state)
                    .then(() => platformStorage.putData(LtiStorage.cookiePrefix + '_nonce_' + nonce, nonce))
            }
            return Promise.reject();
        })
        .catch((err) => {
            err && console.log(err);
            return this.#setStateAndNonceCookies(state, nonce)
        })
        .then((hasState) => {
            let data : OidcLoginData = {
                ...oidcLoginData,
                state: state,               // State to identify browser session.
                nonce: nonce,               // Prevent replay attacks.
                scope: 'openid',            // OIDC Scope.
                response_type: 'id_token',  // OIDC response is always an id token.
                response_mode: 'form_post', // OIDC response is always a form post.
                prompt: 'none',             // Don't prompt user on redirect.
            }

            return {
                url: platformOidcLoginUrl,
                params: data,
                target: hasState ? '_self' : '_blank',
            }

        });
    }

    doLoginInitiationRedirect(formData: OidcLoginFormData): void {
        let form = document.createElement("form");
        for (let key in formData.params) {
            let element = document.createElement("input");
            element.type = 'hidden';
            element.value = (formData.params as any)[key];
            element.name = key;
            form.appendChild(element);
        };

        form.method = "POST";
        form.action = formData.url.toString();

        document.body.appendChild(form);

        form.submit();
    }

    async validateStateAndNonce(state: string, nonce: string, platformOrigin: URL, launchFrame: Window|undefined): Promise<boolean> {
        // Check cookie first
        if (document.cookie.split('; ').includes(LtiStorage.cookiePrefix + '_state_' + state + '=' + state)
            && document.cookie.split('; ').includes(LtiStorage.cookiePrefix + '_nonce_' + nonce + '=' + nonce)) {
            // Found state in cookie, return true
            return Promise.resolve(true);
        }
        let platformStorage = this.ltiPostMessage(platformOrigin, launchFrame);
        return platformStorage.getData(LtiStorage.cookiePrefix + '_state_' + state)
        .then((value) => {
            if (!value || state !== value) {
                return Promise.reject();
            }
            return platformStorage.getData(LtiStorage.cookiePrefix + '_nonce_' + nonce);
        })
        .then((value) => {
            if (!value || nonce !== value) {
                return Promise.reject();
            }
            return true;
        })
        .catch(() => { return false; });
    }

    ltiPostMessage(targetOrigin: URL, launchFrame?: Window|undefined): LtiPostMessage {
        return new LtiPostMessage(targetOrigin, launchFrame, this.#debug);
    }

    #setStateAndNonceCookies(state: string, nonce: string): boolean {
        document.cookie = LtiStorage.cookiePrefix + '_state_' + state + '=' + state + '; path=/; samesite=none; secure; expires=' + (new Date(Date.now() + 300*1000)).toUTCString();
        document.cookie = LtiStorage.cookiePrefix + '_nonce_' + nonce + '=' + nonce + '; path=/; samesite=none; secure; expires=' + (new Date(Date.now() + 300*1000)).toUTCString();

        return document.cookie.split('; ').includes(LtiStorage.cookiePrefix + '_state_' + state + '=' + state)
            && document.cookie.split('; ').includes(LtiStorage.cookiePrefix + '_nonce_' + nonce  + '=' + nonce);
    }

}

class LtiPostMessage {
    #debug = false;
    _targetOrigin;
    _launchFrame;
    constructor(targetOrigin: URL, launchFrame: Window|undefined, debug: boolean) {
        this.#debug = debug;
        this._targetOrigin = targetOrigin;
        this._launchFrame = launchFrame || window;
    }

    static secureRandom(length?: number): string {
        let random = new Uint8Array(length||63);
        crypto.getRandomValues(random);
        return btoa(String.fromCharCode(...random)).replace(/\//g, '_').replace(/\+/g, '-');
    }

    async sendPostMessage(data: LtiPostMessageData, targetWindow: Window, originOverride?: string|undefined, targetFrameName?: string|undefined): Promise<LtiPostMessageData> {
        return new Promise ((resolve, reject) => {
            let log = new LtiPostMessageLog(this.#debug);
            let timeout: number;
            let targetOrigin = originOverride || this._targetOrigin.origin;
            data.message_id = 'message-' + LtiPostMessage.secureRandom(15);
            let targetFrame: Window;
            try {
                targetFrame = this.#getTargetFrame(targetWindow, targetFrameName);
            } catch (e) {
                log.error({message: 'Failed to access target frame with name: [' + targetFrameName + '] falling back to use target window - Error: [' + e + ']'});
                targetFrameName = undefined;
                targetFrame = targetWindow;
            }
            const messageHandler = (event: MessageEvent) => {
                if (event.data.message_id !== data.message_id) {
                    log.error({message: 'Ignoring message, invalid message_id: [' + event.data.message_id + '] expected: [' + data.message_id + ']'});
                    return;
                }
                log.response(event);
                if (targetOrigin !== '*' && event.origin !== targetOrigin) {
                    log.error({message: 'Ignoring message, invalid origin: ' + event.origin});
                    return log.print();
                }
                if (event.data.subject !== data.subject + '.response') {
                    log.error({message: 'Ignoring message, invalid subject: [' + event.data.subject + '] expected: [' + data.subject + '.response]'});
                    return log.print();
                }
                window.removeEventListener('message', messageHandler);
                clearTimeout(timeout);
                if (event.data.error) {
                    log.error(event.data.error);
                    log.print();
                    return reject(event.data.error);
                }
                log.print();
                resolve(event.data);
            };
            window.addEventListener('message', messageHandler);
            log.request(targetFrameName, data, targetOrigin);
            targetFrame.postMessage(data, targetOrigin);
            timeout = setTimeout(() => {
                window.removeEventListener('message', messageHandler);
                let timeout_error = {
                    code: 'timeout',
                    message: 'No response received after 1000ms'
                };
                log.error(timeout_error);
                log.print();
                reject(timeout_error);
            }, 1000);
        });
    };

    async sendPostMessageIfCapable(data: LtiPostMessageData): Promise<LtiPostMessageData> {
        // Call capability service
        return Promise.any([
            this.sendPostMessage({subject: 'lti.capabilities'}, this.#getTargetWindow(), '*'),
            // Send new and old capabilities messages for support with pre-release subjects
            this.sendPostMessage({subject: 'org.imsglobal.lti.capabilities'}, this.#getTargetWindow(), '*')
        ])
        .then((capabilities) => {
            if (typeof capabilities.supported_messages == 'undefined') {
                return Promise.reject({
                    code: 'not_found',
                    message: 'No capabilities'
                });
            }
            for (let i = 0; i < capabilities.supported_messages.length; i++) {
                if (![data.subject, 'org.imsglobal.' + data.subject].includes(capabilities.supported_messages[i].subject)) {
                    continue;
                }
                // Use subject specified in capabilities for backwards compatibility
                data.subject = capabilities.supported_messages[i].subject;
                return this.sendPostMessage(data, this.#getTargetWindow(), undefined, capabilities.supported_messages[i].frame);
            }
            return Promise.reject({
                code: 'not_found',
                message: 'Capabilities not found'
            });
        });
    };

    async putData(key: string, value: any): Promise<boolean> {
        return this.sendPostMessageIfCapable({
            subject: 'lti.put_data',
            key: key,
            value: value
        })
        .then((response) => {
            return true;
        });
    };

    async getData(key: string): Promise<any> {
        return this.sendPostMessageIfCapable({
            subject: 'lti.get_data',
            key: key
        })
        .then((response) => {
            return response.value;
        });
    };

    #getTargetWindow(): Window {
        return this._launchFrame.opener || this._launchFrame.parent;
    };

    #getTargetFrame(targetWindow: Window, frameName: string|undefined): Window {
        if (frameName && (targetWindow.frames as any)[frameName]) {
            return (targetWindow.frames as any)[frameName];
        }
        return targetWindow;
    }

}

class LtiPostMessageLog {
    #debug = false;
    _request: any = {};
    _response: any = {};
    _error: any[] = [];
    _start_time = Date.now();

    constructor(debug: boolean) {
        this.#debug = debug;
    }

    request(targetFrameName: string | undefined, data: any, targetOrigin: string) {
        this._request = {
            timestamp: Date.now(),
            targetFrameName: targetFrameName,
            data: data,
            targetOrigin: targetOrigin
        }
    };

    response(event: MessageEvent) {
        this._response = {
            timestamp: Date.now(),
            origin: event.origin,
            data: event.data,
            event: event
        }
    };

    error(error: any) {
        this._error[this._error.length] = {
            error: error,
            timestamp: Date.now()
        }
    };

    print() {
        if (!this.#debug) {
            return;
        }
        let reqTime = Date.now() - this._start_time;
        console.groupCollapsed(
            '%c %c request time: ' + reqTime + (this._request.timestamp ? "ms\t " + this._request.data.subject : ''),
            'padding-left:' + (Math.min(reqTime,100)*6) + 'px; background-color: ' + (this._error.length ? (this._response.timestamp ? 'orange' : 'red') : 'green') + ';',
            'padding-left:' + (10+(Math.max(0,10-reqTime)*6)) + 'px; background-color: transparent'
        );
        if (this._request.timestamp) {
            console.groupCollapsed(
                'Request ' +
                ' - timestamp: ' + this._request.timestamp +
                ' - message_id: ' + this._request.data.message_id +
                ' - action: ' + this._request.data.subject +
                ' - origin: ' + this._request.targetOrigin +
                (this._request.targetFrameName ? ' - target: ' + this._request.targetFrameName : '')
            );
            console.log('Sent from: ' + window.location.href);
            console.log(JSON.stringify(this._request.data, null, '    '));
            console.groupEnd();
        }
        if (this._response.timestamp) {
            console.groupCollapsed(
                'Response' +
                ' - timestamp: ' + this._response.timestamp +
                ' - message_id: ' + this._response.data.message_id +
                ' - action: ' + this._response.data.subject +
                ' - origin: ' + this._response.origin
            );
            console.log(JSON.stringify(this._response.data, null, '    '));
            console.groupEnd();
        }
        if (this._error.length) {
            console.groupCollapsed(this._error.length + ' Error' + (this._error.length > 1 ? 's' : ''));
            for (let i=0; i<this._error.length; i++) {
                console.log(this._error[i].error.message || this._error[i].error);
            }
            console.groupEnd();
        }
        console.groupEnd();
    };
}