"use client";

import { useEvent } from "@/hooks/use-event";
import { Chess, Move, Square } from "chess.js";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import { Chessboard } from "@gustavotoyota/react-chessboard";
import { Arrow } from "@gustavotoyota/react-chessboard/dist/chessboard/types";
import ChessLines from "@/components/chess-lines";
import { getScoreText } from "@/misc/utils";
import EvaluationBar from "@/components/evaluation-bar";
import useStateWithRef from "@/hooks/use-ref-with-state";
import GameHistory from "@/components/game-history";
import PgnLoader from "@/components/pgn-loader";
import { ChessLine, MoveScore } from "@/misc/types";
import FenLoader from "@/components/fen-loader";

export default function Home() {
  const game = useRef<Chess>() as MutableRefObject<Chess>;
  if (game.current == null) {
    game.current = new Chess();
  }

  const startingPoint = useRef("startpos");

  const [history, setHistory, historyRef] = useStateWithRef<Move[]>([]);
  const [fen, setFen] = useState(game.current.fen());
  const [moveIndex, setMoveIndex, moveIndexRef] = useStateWithRef(0);

  const stockfish = useRef<Worker>() as MutableRefObject<Worker>;

  const stockfishMoveIndex = useRef(0);
  const stockfishTurn = useRef<"w" | "b">("w");

  const [bestLines, setBestLines, bestLinesRef] = useStateWithRef<
    Map<number, ChessLine>
  >(new Map());
  const [arrows, setArrows] = useState<Arrow[]>([]);

  const [numCustomMoves, setNumCustomMoves, numCustomMovesRef] =
    useStateWithRef(0);
  const [customMoves, setCustomMoves, customMovesRef] = useStateWithRef<Move[]>(
    []
  );

  const [moveScores, setMoveScores] = useState<Map<number, MoveScore>>(
    new Map()
  );

  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">(
    "white"
  );

  function getMoveObjects(lans: string[]): Move[] {
    const moves: Move[] = [];

    try {
      for (const lan of lans) {
        moves.push(game.current.move(lan));
      }
    } catch {}

    for (let i = 0; i < moves.length; ++i) {
      game.current.undo();
    }

    if (moves.length === lans.length) {
      return moves;
    } else {
      return lans.map(
        (lan) =>
          ({
            from: lan.slice(0, 2) as Square,
            to: lan.slice(2, 4) as Square,
            lan,
            san: "",
          } as Move)
      );
    }
  }

  useEffect(() => {
    stockfish.current = new Worker("stockfish-nnue-16.js");

    stockfish.current.onmessage = (event) => {
      if (event.data.startsWith("info depth")) {
        const info = event.data.split(" ");

        const lineDepth = info[2];
        const lineId = info[info.indexOf("multipv") + 1];

        if (
          (info[3] === "seldepth" && lineDepth === "1" && lineId === "1") ||
          info[4] === "mate"
        ) {
          stockfishMoveIndex.current = moveIndexRef.current;
          stockfishTurn.current = game.current.turn();

          setBestLines(new Map());
          setArrows([]);
        }

        if (info[3] !== "seldepth") {
          return;
        }

        const lineMoves: string[] = [];

        for (
          let i = info.indexOf("pv") + 1;
          i < info.length && lineMoves.length < 15;
          i++
        ) {
          lineMoves.push(info[i]);
        }

        const scoreIndex = info.indexOf("score");

        let lineScore = parseInt(info[scoreIndex + 2]);

        if (stockfishTurn.current === "b") {
          lineScore = -lineScore;
        }

        const mate = info[scoreIndex + 1] === "mate";

        const scoreText = getScoreText({ mate, score: lineScore });

        bestLinesRef.current.set(lineId - 1, {
          moves: getMoveObjects(lineMoves),
          mate: mate,
          score: lineScore,
          scoreText: scoreText,
        });

        if (lineId === "1") {
          setMoveScores((oldMoveScores) => {
            const newMoveScores = new Map(oldMoveScores);

            newMoveScores.set(stockfishMoveIndex.current, {
              mate: mate,
              score: lineScore,
            });

            return newMoveScores;
          });
        }

        setBestLines(new Map(bestLinesRef.current));

        const newArrows: Arrow[] = [];
        const moveSet = new Set<string>();

        for (const [index, line] of Array.from(
          bestLinesRef.current.entries()
        )) {
          if (moveSet.has(line.moves[0].lan)) {
            continue;
          }

          newArrows.push({
            from: line.moves[0].from,
            to: line.moves[0].to,

            color: "#003088",
            width: 16 - 2 * index,
            opacity: 0.4 - 0.05 * index,

            text: line.scoreText,
            textColor: "#b80000",
            fontSize: "15",
            fontWeight: "bold",
          });

          moveSet.add(line.moves[0].lan);
        }

        setArrows(newArrows);
      }

      if (event.data === "uciok") {
        stockfish.current.postMessage(
          `setoption name Threads value ${navigator.hardwareConcurrency}`
        );
        stockfish.current.postMessage("setoption name Hash value 128");
        stockfish.current.postMessage("setoption name MultiPV value 5");

        updateBoard();

        return;
      }
    };

    stockfish.current.postMessage("uci");
  }, []);

  useEvent("keydown", (event) => {
    if (event.code === "ArrowLeft") {
      goBackward();
    } else if (event.code === "ArrowRight") {
      goForward();
    } else if (event.code === "KeyF") {
      flipBoard();
    }
  });

  function flipBoard() {
    setBoardOrientation((oldBoardOrientation) =>
      oldBoardOrientation === "white" ? "black" : "white"
    );
  }

  function updateBoard() {
    const moves = historyRef.current
      .slice(0, moveIndexRef.current)
      .concat(customMovesRef.current.slice(0, numCustomMovesRef.current))
      .map((move) => move.lan)
      .join(" ");

    stockfish.current?.postMessage("stop");
    if (startingPoint.current === "startpos") {
      stockfish.current?.postMessage(`position startpos moves ${moves}`);
    } else {
      stockfish.current?.postMessage(
        `position fen ${startingPoint.current} moves ${moves}`
      );
    }
    stockfish.current?.postMessage("go depth 20");

    setFen(game.current.fen());
  }

  function analyzeGame() {
    setHistory(game.current.history({ verbose: true }));

    setNumCustomMoves(0);
    setCustomMoves([]);

    setMoveIndex(historyRef.current.length);

    updateBoard();
  }

  function resetBoard() {
    game.current.reset();

    setHistory([]);

    setNumCustomMoves(0);
    setCustomMoves([]);

    setMoveIndex(0);

    updateBoard();
  }

  function goToBeginning() {
    let executed = false;

    while (numCustomMovesRef.current > 0 || moveIndexRef.current > 0) {
      goBackward({ updateBoard: false });

      executed = true;
    }

    if (executed) {
      updateBoard();
    }
  }

  function goBackward(params?: { updateBoard?: boolean }) {
    if (numCustomMovesRef.current > 0) {
      setNumCustomMoves(numCustomMovesRef.current - 1);

      if (numCustomMovesRef.current <= 0 && historyRef.current.length > 0) {
        setCustomMoves([]);
      }

      game.current.undo();
      updateBoard();
      return;
    }

    if (moveIndexRef.current <= 0) {
      return;
    }

    setMoveIndex(Math.max(moveIndexRef.current - 1, 0));

    game.current.undo();

    if (params?.updateBoard !== false) {
      updateBoard();
    }
  }

  function goForward(params?: { updateBoard?: boolean }) {
    if (customMovesRef.current.length > 0) {
      if (numCustomMovesRef.current < customMovesRef.current.length) {
        game.current.move(customMovesRef.current[numCustomMovesRef.current]);

        setNumCustomMoves(numCustomMovesRef.current + 1);

        updateBoard();
      }

      return;
    }

    if (moveIndexRef.current >= historyRef.current.length) {
      return;
    }

    game.current.move(historyRef.current[moveIndexRef.current]);
    setMoveIndex(moveIndexRef.current + 1);

    if (params?.updateBoard !== false) {
      updateBoard();
    }
  }

  function goToEnd() {
    let executed = false;

    while (
      numCustomMovesRef.current < customMovesRef.current.length ||
      moveIndexRef.current < historyRef.current.length
    ) {
      goForward({ updateBoard: false });

      executed = true;
    }

    if (executed) {
      updateBoard();
    }
  }

  function executeMove(moveStr: string) {
    try {
      const moveObject = game.current.move(moveStr);

      setCustomMoves([
        ...customMovesRef.current.slice(0, numCustomMovesRef.current),
        moveObject,
      ]);
      setNumCustomMoves(numCustomMovesRef.current + 1);

      updateBoard();

      return true;
    } catch {
      return false;
    }
  }

  function executeMoves(moves: string[]) {
    let numSuccessful = 0;

    for (const move of moves) {
      if (executeMove(move)) {
        numSuccessful++;
      } else {
        break;
      }
    }

    if (numSuccessful !== moves.length) {
      for (let i = 0; i < numSuccessful; ++i) {
        game.current.undo();
      }
    }

    return numSuccessful === moves.length;
  }

  function goToMove(moveIndex: number) {
    let executed = false;

    while (moveIndex < moveIndexRef.current + numCustomMovesRef.current - 1) {
      goBackward({ updateBoard: false });

      executed = true;
    }

    while (moveIndex > moveIndexRef.current + numCustomMovesRef.current - 1) {
      goForward({ updateBoard: false });

      executed = true;
    }

    if (executed) {
      updateBoard();
    }
  }

  return (
    <main className="h-full flex items-center justify-center flex-col">
      <div className="flex">
        <div className="flex items-center flex-col">
          <div className="flex">
            <EvaluationBar
              score={bestLines.get(0) ?? { mate: false, score: 0 }}
            />

            <div className="w-6" />

            <div className="w-[500px]">
              <Chessboard
                position={fen}
                areArrowsAllowed={false}
                customArrows={arrows}
                onPieceDrop={(
                  sourceSquare: Square,
                  targetSquare: Square,
                  piece: string
                ) => executeMove(sourceSquare + targetSquare)}
                boardOrientation={boardOrientation}
              ></Chessboard>
            </div>
          </div>

          <div className="h-8" />

          <div className="flex">
            <input
              type="button"
              value="Reset"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => resetBoard()}
            />

            <div className="w-4" />

            <input
              type="button"
              value="|<"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => goToBeginning()}
            />

            <div className="w-4" />

            <input
              type="button"
              value="<"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => goBackward()}
            />

            <div className="w-2" />

            <input
              type="button"
              value=">"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => goForward()}
            />

            <div className="w-4" />

            <input
              type="button"
              value=">|"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => goToEnd()}
            />

            <div className="w-4" />

            <input
              type="button"
              value="Flip"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => flipBoard()}
            />
          </div>

          <div className="h-8" />

          <FenLoader
            onLoad={(fen) => {
              startingPoint.current = fen;
              game.current.load(fen);

              analyzeGame();
            }}
          />

          <div className="h-6" />

          <PgnLoader
            onLoad={(pgn) => {
              startingPoint.current = "startpos";
              game.current.loadPgn(pgn);

              analyzeGame();
            }}
          />
        </div>

        <div className="w-8"></div>

        <div className="w-96 h-[700px] bg-neutral-700 p-4 text-xs text-neutral-200 flex flex-col">
          <ChessLines
            lines={bestLines}
            onMovesSelected={(moves) => {
              executeMoves(moves.map((move) => move.lan));
            }}
          />

          <div className="h-4"></div>

          <GameHistory
            moveIndex={moveIndex + numCustomMoves - 1}
            numCustomMoves={customMoves.length}
            moves={(customMoves.length > 0
              ? history.slice(0, moveIndex)
              : history
            ).concat(customMoves)}
            onMoveSelected={(moveIndex) => goToMove(moveIndex)}
          />
        </div>
      </div>
    </main>
  );
}
