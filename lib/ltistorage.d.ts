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
declare class LtiStorage {
    #private;
    static cookiePrefix: string;
    constructor(debug: boolean);
    initToolLogin(platformOidcLoginUrl: URL, oidcLoginData: OidcLoginData, launchFrame: Window | undefined): Promise<void>;
    setStateAndNonce(platformOidcLoginUrl: URL, oidcLoginData: OidcLoginData, launchFrame: Window | undefined): Promise<OidcLoginFormData>;
    doLoginInitiationRedirect(formData: OidcLoginFormData): void;
    validateStateAndNonce(state: string, nonce: string, platformOrigin: URL, launchFrame: Window | undefined): Promise<boolean>;
    ltiPostMessage(targetOrigin: URL, launchFrame?: Window | undefined): LtiPostMessage;
}
declare class LtiPostMessage {
    #private;
    _targetOrigin: URL;
    _launchFrame: Window;
    constructor(targetOrigin: URL, launchFrame: Window | undefined, debug: boolean);
    static secureRandom(length?: number): string;
    sendPostMessage(data: LtiPostMessageData, targetWindow: Window, originOverride?: string | undefined, targetFrameName?: string | undefined): Promise<LtiPostMessageData>;
    sendPostMessageIfCapable(data: LtiPostMessageData): Promise<LtiPostMessageData>;
    putData(key: string, value: any): Promise<boolean>;
    getData(key: string): Promise<any>;
}
declare class LtiPostMessageLog {
    #private;
    _request: any;
    _response: any;
    _error: any[];
    _start_time: number;
    constructor(debug: boolean);
    request(targetFrameName: string | undefined, data: any, targetOrigin: string): void;
    response(event: MessageEvent): void;
    error(error: any): void;
    print(): void;
}
