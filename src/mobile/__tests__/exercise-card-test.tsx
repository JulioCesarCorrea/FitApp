import { act, render, screen } from '@testing-library/react-native';
import { ExerciseCard, IMAGE_MAX_RETRIES, IMAGE_RETRY_MS } from '../src/components/ExerciseCard';
import type { CatalogExercise } from '../src/data/types';

const exercise: CatalogExercise = {
  id: 'curl-zottman', name: 'Curl Zottman', primaryZone: 'antebrazos', secondaryZones: [], movements: [],
  equipment: 'Mancuernas', bar: null, images: ['/exercise-images/curl-zottman-0.jpg'],
};

const IMAGE = 'image-curl-zottman';

const failImage = async () =>
  act(async () => screen.getByTestId(IMAGE).props.onError({ nativeEvent: { error: 'Not Found (404)' } }));

const wait = async (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe('Tarjeta del ejercicio: imagen que no carga (AC-mobile-002-02)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });

  it('muestra solo el nombre al fallar y reintenta pasado el tiempo', async () => {
    await render(<ExerciseCard exercise={exercise} imageUrl="http://api.test/x.jpg" onPress={() => {}} />);

    await failImage();
    expect(screen.queryByTestId(IMAGE)).not.toBeOnTheScreen();
    expect(screen.getByText('Curl Zottman')).toBeOnTheScreen();

    await wait(IMAGE_RETRY_MS);
    expect(screen.getByTestId(IMAGE)).toBeOnTheScreen();
    const source = screen.getByTestId(IMAGE).props.source;
    expect((Array.isArray(source) ? source[0] : source).uri).toBe('http://api.test/x.jpg?r=1');
  });

  it('deja un registro con la dirección que falló', async () => {
    await render(<ExerciseCard exercise={exercise} imageUrl="http://api.test/x.jpg" onPress={() => {}} />);

    await failImage();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('http://api.test/x.jpg'));
  });

  it('deja de reintentar tras el máximo de intentos y queda el nombre', async () => {
    await render(<ExerciseCard exercise={exercise} imageUrl="http://api.test/x.jpg" onPress={() => {}} />);

    for (let i = 0; i < IMAGE_MAX_RETRIES; i++) {
      await failImage();
      await wait(IMAGE_RETRY_MS);
      expect(screen.getByTestId(IMAGE)).toBeOnTheScreen();
    }
    await failImage();
    await wait(IMAGE_RETRY_MS * 3);

    expect(screen.queryByTestId(IMAGE)).not.toBeOnTheScreen();
    expect(screen.getByText('Curl Zottman')).toBeOnTheScreen();
  });

  it('si la imagen carga a la primera no hay reintentos', async () => {
    await render(<ExerciseCard exercise={exercise} imageUrl="http://api.test/x.jpg" onPress={() => {}} />);

    await wait(IMAGE_RETRY_MS * 2);

    expect(screen.getByTestId(IMAGE)).toBeOnTheScreen();
    expect(warn).not.toHaveBeenCalled();
  });
});
