import { showWebAlert, installWebAlert } from './webAlert';

const env = (confirmResult = true) => ({ alert: jest.fn(), confirm: jest.fn(() => confirmResult) });

describe('showWebAlert', () => {
  it('shows a plain message and runs the lone button', () => {
    const e = env();
    const onPress = jest.fn();
    showWebAlert('Error', 'Nope', [{ text: 'OK', onPress }], e);
    expect(e.alert).toHaveBeenCalledWith('Error\n\nNope');
    expect(onPress).toHaveBeenCalled();
  });
  it('shows a message with no buttons', () => {
    const e = env();
    showWebAlert('Pick a time', undefined, undefined, e);
    expect(e.alert).toHaveBeenCalledWith('Pick a time');
  });
  it('runs the confirm action only when the browser confirm is accepted', () => {
    const action = jest.fn();
    const cancel = jest.fn();
    const buttons = [{ text: 'Never mind', style: 'cancel', onPress: cancel }, { text: 'Cancel it', style: 'destructive', onPress: action }];
    showWebAlert('Cancel this reservation?', 'Customer is notified', buttons, env(true));
    expect(action).toHaveBeenCalledTimes(1);
    showWebAlert('Cancel this reservation?', 'Customer is notified', buttons, env(false));
    expect(action).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('installs over Alert.alert', () => {
    const Alert = { alert: () => {} };
    installWebAlert(Alert);
    expect(Alert.alert).not.toBe(undefined);
  });
});
